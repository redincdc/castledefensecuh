/**
 * Cannon Tower
 * Slow fire rate, high damage, effective against armored enemies.
 */
class CannonTower extends Tower {
    constructor(x, y, startLevel = 0) {
        super('cannon', x, y, startLevel);
    }
}
