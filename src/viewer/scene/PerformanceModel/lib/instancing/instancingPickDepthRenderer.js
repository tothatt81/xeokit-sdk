import {Map} from "../../../utils/Map.js";
import {stats} from "../../../stats.js"
import {Program} from "../../../webgl/Program.js";
import {InstancingPickDepthShaderSource} from "./instancingPickDepthShaderSource.js";

const ids = new Map({});

/**
 * @private
 */
const InstancingPickDepthRenderer = function (hash, layer) {
    this.id = ids.addItem({});
    this._hash = hash;
    this._scene = layer.model.scene;
    this._useCount = 0;
    this._shaderSource = new InstancingPickDepthShaderSource(layer);
    this._allocate(layer);
};

const renderers = {};

InstancingPickDepthRenderer.get = function (layer) {
    const scene = layer.model.scene;
    const hash = getHash(scene);
    let renderer = renderers[hash];
    if (!renderer) {
        renderer = new InstancingPickDepthRenderer(hash, layer);
        if (renderer.errors) {
            console.log(renderer.errors.join("\n"));
            return null;
        }
        renderers[hash] = renderer;
        stats.memory.programs++;
    }
    renderer._useCount++;
    return renderer;
};

function getHash(scene) {
    return [scene.canvas.canvas.id, "", scene._sectionPlanesState.getHash()].join(";")
}

InstancingPickDepthRenderer.prototype.getValid = function () {
    return this._hash === getHash(this._scene);
};

InstancingPickDepthRenderer.prototype.put = function () {
    if (--this._useCount === 0) {
        ids.removeItem(this.id);
        if (this._program) {
            this._program.destroy();
        }
        delete renderers[this._hash];
        stats.memory.programs--;
    }
};

InstancingPickDepthRenderer.prototype.webglContextRestored = function () {
    this._program = null;
};

InstancingPickDepthRenderer.prototype.drawLayer = function (frameCtx, layer) {

    const model = layer.model;
    const scene = model.scene;
    const gl = scene.canvas.gl;
    const state = layer._state;
    const instanceExt = this._instanceExt;

    if (!this._program) {
        this._allocate(layer);
        if (this.errors) {
            return;
        }
    }

    if (frameCtx.lastProgramId !== this._program.id) {
        frameCtx.lastProgramId = this._program.id;
        this._bindProgram(frameCtx, layer);
    }

    const camera = scene.camera;
    const projectState = camera.project._state;
    gl.uniformMatrix4fv(this._uViewMatrix, false, frameCtx.pickViewMatrix);
    gl.uniformMatrix4fv(this._uProjMatrix, false, frameCtx.pickProjMatrix);
    gl.uniform1f(this._uZNear, projectState.near);
    gl.uniform1f(this._uZFar, projectState.far);

    gl.uniformMatrix4fv(this._uPositionsDecodeMatrix, false, layer._state.positionsDecodeMatrix);

    this._aModelMatrixCol0.bindArrayBuffer(state.modelMatrixCol0Buf);
    this._aModelMatrixCol1.bindArrayBuffer(state.modelMatrixCol1Buf);
    this._aModelMatrixCol2.bindArrayBuffer(state.modelMatrixCol2Buf);

    instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol0.location, 1);
    instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol1.location, 1);
    instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol2.location, 1);
    frameCtx.bindArray += 3;

    this._aPosition.bindArrayBuffer(state.positionsBuf);
    frameCtx.bindArray++;

    this._aFlags.bindArrayBuffer(state.flagsBuf);
    instanceExt.vertexAttribDivisorANGLE(this._aFlags.location, 1);
    frameCtx.bindArray++;

    if (this._aFlags2) {
        this._aFlags2.bindArrayBuffer(state.flags2Buf);
        instanceExt.vertexAttribDivisorANGLE(this._aFlags2.location, 1);
        frameCtx.bindArray++;
    }

    state.indicesBuf.bind();
    frameCtx.bindArray++;

    instanceExt.drawElementsInstancedANGLE(state.primitive, state.indicesBuf.numItems, state.indicesBuf.itemType, 0, state.numInstances);

    // Cleanup

    instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol0.location, 0);
    instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol1.location, 0);
    instanceExt.vertexAttribDivisorANGLE(this._aModelMatrixCol2.location, 0);;
    instanceExt.vertexAttribDivisorANGLE(this._aFlags.location, 0);
    if (this._aFlags2) { // Won't be in shader when not clipping
        instanceExt.vertexAttribDivisorANGLE(this._aFlags2.location, 0);
    }

    frameCtx.drawElements++;
};

InstancingPickDepthRenderer.prototype._allocate = function (layer) {
    var scene = layer.model.scene;
    const gl = scene.canvas.gl;
    const sectionPlanesState = scene._sectionPlanesState;

    this._program = new Program(gl, this._shaderSource);

    if (this._program.errors) {
        this.errors = this._program.errors;
        return;
    }

    this._instanceExt = gl.getExtension("ANGLE_instanced_arrays");

    const program = this._program;

    this._uPositionsDecodeMatrix = program.getLocation("positionsDecodeMatrix");
    this._uViewMatrix = program.getLocation("viewMatrix");
    this._uProjMatrix = program.getLocation("projMatrix");

    this._uSectionPlanes = [];
    const clips = sectionPlanesState.sectionPlanes;
    for (var i = 0, len = clips.length; i < len; i++) {
        this._uSectionPlanes.push({
            active: program.getLocation("sectionPlaneActive" + i),
            pos: program.getLocation("sectionPlanePos" + i),
            dir: program.getLocation("sectionPlaneDir" + i)
        });
    }

    this._aPosition = program.getAttribute("position");
    this._aFlags = program.getAttribute("flags");
    this._aFlags2 = program.getAttribute("flags2");

    this._aModelMatrixCol0 = program.getAttribute("modelMatrixCol0");
    this._aModelMatrixCol1 = program.getAttribute("modelMatrixCol1");
    this._aModelMatrixCol2 = program.getAttribute("modelMatrixCol2");

    this._uZNear = program.getLocation("zNear");
    this._uZFar = program.getLocation("zFar");
};

InstancingPickDepthRenderer.prototype._bindProgram = function (frameCtx, layer) {
    const scene = this._scene;
    const gl = scene.canvas.gl;
    const program = this._program;
    const sectionPlanesState = scene._sectionPlanesState;
    program.bind();
    frameCtx.useProgram++;
    if (sectionPlanesState.sectionPlanes.length > 0) {
        const clips = scene._sectionPlanesState.sectionPlanes;
        let sectionPlaneUniforms;
        let uSectionPlaneActive;
        let sectionPlane;
        let uSectionPlanePos;
        let uSectionPlaneDir;
        for (var i = 0, len = this._uSectionPlanes.length; i < len; i++) {
            sectionPlaneUniforms = this._uSectionPlanes[i];
            uSectionPlaneActive = sectionPlaneUniforms.active;
            sectionPlane = clips[i];
            if (uSectionPlaneActive) {
                gl.uniform1i(uSectionPlaneActive, sectionPlane.active);
            }
            uSectionPlanePos = sectionPlaneUniforms.pos;
            if (uSectionPlanePos) {
                gl.uniform3fv(sectionPlaneUniforms.pos, sectionPlane.pos);
            }
            uSectionPlaneDir = sectionPlaneUniforms.dir;
            if (uSectionPlaneDir) {
                gl.uniform3fv(sectionPlaneUniforms.dir, sectionPlane.dir);
            }
        }
    }
};

export {InstancingPickDepthRenderer};
