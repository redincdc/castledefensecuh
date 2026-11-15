/**
 * Mortar Tower
 * Long range, slow fire rate, deals splash damage on impact.
 */
class MortarTower extends Tower {
    constructor(x, y, startLevel = 0) {
        super('mortar', x, y, startLevel);
    }
}
