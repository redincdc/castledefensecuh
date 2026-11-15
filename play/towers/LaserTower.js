/**
 * Laser Tower
 * Fires a continuous beam in a fixed direction that can reflect off mirrors.
 */
class LaserTower extends Tower {
    constructor(x, y, startLevel = 0) {
        super('laser', x, y, startLevel);
    }
}
