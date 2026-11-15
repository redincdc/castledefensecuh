/**
 * InputManager handles canvas interactions, coordinate scaling, and world input events.
 */
class InputManager {
    constructor(scene) {
        this.scene = scene;
        this.canvas = scene.canvas;
        this.setupListeners();
    }

    setupListeners() {
        console.log("InputManager: setting up listeners...");

        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e));
    }

    getCanvasCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    handleMouseDown(e) {
        if (!this.scene.gameStateManager.isPlaying || this.scene.gameStateManager.isPaused) return;
        const coords = this.getCanvasCoords(e);
        const x = coords.x;
        const y = coords.y;
        this.scene.handleMouseDown(e, x, y);
    }

    handleMouseMove(e) {
        const coords = this.getCanvasCoords(e);
        const x = coords.x;
        const y = coords.y;
        this.scene.handleMouseMove(e, x, y);
    }

    handleMouseUp(e) {
        this.scene.handleMouseUp(e);
    }
}
