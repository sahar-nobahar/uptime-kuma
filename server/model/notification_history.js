const { BeanModel } = require("redbean-node/dist/bean-model");
const { R } = require("redbean-node");

/**
 * Status values are stored as booleans (success = 1, fail = 0).
 * Columns: id, notification_id, monitor_id, type, notification_name,
 * message, success, error, created_date.
 */
class NotificationHistory extends BeanModel {
    /**
     * Return an object that is ready to parse to JSON
     * @returns {object} Object ready to parse
     */
    toJSON() {
        return {
            id: this.id,
            notificationID: this.notification_id,
            monitorID: this.monitor_id,
            type: this.type,
            notificationName: this.notification_name,
            message: this.message,
            success: !!this.success,
            error: this.error,
            createdDate: this.created_date,
        };
    }

    /**
     * Record one notification attempt. Never throws: history must not
     * break notification delivery. Returns the stored bean or null.
     * @param {object} entry Entry to record
     * @param {?number} entry.monitorID Monitor id (nullable, e.g. test send)
     * @param {?number} entry.notificationID Notification id (nullable)
     * @param {?string} entry.type Provider type (e.g. "discord")
     * @param {?string} entry.notificationName Snapshot of notification name
     * @param {?string} entry.message Message that was (or was to be) sent
     * @param {boolean} entry.success Did the send succeed?
     * @param {?string} entry.error Error message on failure
     * @returns {Promise<BeanModel|null>} Stored bean or null on failure
     */
    static async record(entry) {
        try {
            const bean = R.dispense("notification_history");
            bean.notification_id = entry.notificationID ?? null;
            bean.monitor_id = entry.monitorID ?? null;
            bean.type = entry.type ?? null;
            bean.notification_name = entry.notificationName ?? null;
            bean.message = entry.message ?? null;
            bean.success = entry.success ? 1 : 0;
            bean.error = entry.error ?? null;
            bean.created_date = R.isoDateTime();
            await R.store(bean);
            return bean;
        } catch {
            // History is best-effort; delivery errors are logged by callers.
            return null;
        }
    }

    /**
     * Get paginated history, newest first.
     * @param {object} opts Query options
     * @param {?number} opts.monitorID Filter by monitor id
     * @param {?number} opts.notificationID Filter by notification id
     * @param {number} opts.limit Page size (clamped 1..100)
     * @param {number} opts.offset Page offset
     * @returns {Promise<{rows: object[], total: number}>} Rows + total count
     */
    static async getHistory({ monitorID = null, notificationID = null, limit = 25, offset = 0 } = {}) {
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

        const conditions = [];
        const params = [];
        if (monitorID != null) {
            conditions.push("monitor_id = ?");
            params.push(monitorID);
        }
        if (notificationID != null) {
            conditions.push("notification_id = ?");
            params.push(notificationID);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        const totalRow = await R.getRow(`SELECT COUNT(*) AS count FROM notification_history ${where}`, params);
        const total = totalRow ? parseInt(totalRow.count, 10) : 0;

        const rows = await R.getAll(
            `SELECT * FROM notification_history ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
            [...params, safeLimit, safeOffset]
        );

        return { rows, total };
    }

    /**
     * Delete history rows (scoped). At least one scope should be given
     * by callers to avoid wiping the whole table by accident.
     * @param {object} opts Delete scope
     * @param {?number} opts.monitorID Filter by monitor id
     * @param {?number} opts.notificationID Filter by notification id
     * @returns {Promise<void>}
     */
    static async clearHistory({ monitorID = null, notificationID = null } = {}) {
        const conditions = [];
        const params = [];
        if (monitorID != null) {
            conditions.push("monitor_id = ?");
            params.push(monitorID);
        }
        if (notificationID != null) {
            conditions.push("notification_id = ?");
            params.push(notificationID);
        }
        if (conditions.length === 0) {
            await R.exec("DELETE FROM notification_history", []);
            return;
        }
        await R.exec(`DELETE FROM notification_history WHERE ${conditions.join(" AND ")}`, params);
    }
}

module.exports = NotificationHistory;
