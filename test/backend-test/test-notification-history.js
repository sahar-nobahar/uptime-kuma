process.env.UPTIME_KUMA_HIDE_LOG = ["info_db", "info_server"].join(",");

const { describe, test, mock, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const TestDB = require("../mock-testdb");
const { R } = require("redbean-node");
const { DOWN } = require("../../src/util");
const NotificationHistory = require("../../server/model/notification_history");

const testDb = new TestDB();

describe("Notification History", () => {
    before(async () => {
        await testDb.create();
    });

    after(async () => {
        const { Settings } = require("../../server/settings");
        Settings.stopCacheCleaner();
        await testDb.destroy();
    });

    beforeEach(async () => {
        await R.exec("DELETE FROM notification_history", []);
    });

    test("migration created the notification_history table", async () => {
        const exists = await R.knex.schema.hasTable("notification_history");
        assert.strictEqual(exists, true);

        const columns = await R.knex("notification_history").columnInfo();
        for (const column of ["monitor_id", "notification_id", "type", "message", "success", "created_date", "error"]) {
            assert.ok(column in columns, `missing column: ${column}`);
        }
    });

    test("record() stores a successful send", async () => {
        const bean = await NotificationHistory.record({
            monitorID: 1,
            notificationID: 2,
            type: "discord",
            notificationName: "My Discord",
            message: "[Monitor] [🔴 Down] timeout",
            success: true,
        });

        assert.ok(bean);
        assert.strictEqual(bean.monitor_id, 1);
        assert.strictEqual(bean.notification_id, 2);
        assert.strictEqual(bean.type, "discord");
        assert.strictEqual(bean.message, "[Monitor] [🔴 Down] timeout");
        assert.ok(bean.success);
        assert.ok(bean.created_date);
    });

    test("record() stores a failed send with the error", async () => {
        await NotificationHistory.record({
            monitorID: 1,
            notificationID: 2,
            type: "webhook",
            notificationName: "Hook",
            message: "hello",
            success: false,
            error: "connect ECONNREFUSED",
        });

        const row = await R.getRow("SELECT * FROM notification_history");
        assert.strictEqual(row.monitor_id, 1);
        assert.strictEqual(!row.success, true);
        assert.strictEqual(row.error, "connect ECONNREFUSED");
    });

    test("getHistory() paginates newest-first and reports the total", async () => {
        for (let i = 1; i <= 5; i++) {
            await NotificationHistory.record({
                monitorID: 7,
                notificationID: 8,
                type: "slack",
                notificationName: "Slack",
                message: `msg-${i}`,
                success: true,
            });
        }

        const page1 = await NotificationHistory.getHistory({ monitorID: 7, limit: 2, offset: 0 });
        assert.strictEqual(page1.total, 5);
        assert.strictEqual(page1.rows.length, 2);
        assert.strictEqual(page1.rows[0].message, "msg-5");
        assert.strictEqual(page1.rows[1].message, "msg-4");

        const page2 = await NotificationHistory.getHistory({ monitorID: 7, limit: 2, offset: 2 });
        assert.strictEqual(page2.total, 5);
        assert.strictEqual(page2.rows.length, 2);
        assert.strictEqual(page2.rows[0].message, "msg-3");
    });

    test("getHistory() filters by monitor and clamps the limit", async () => {
        await NotificationHistory.record({ monitorID: 10, message: "a", success: true });
        await NotificationHistory.record({ monitorID: 11, message: "b", success: true });

        const filtered = await NotificationHistory.getHistory({ monitorID: 10 });
        assert.strictEqual(filtered.total, 1);
        assert.strictEqual(filtered.rows[0].message, "a");

        const clamped = await NotificationHistory.getHistory({ limit: 1000 });
        assert.ok(clamped.rows.length <= 100);
        assert.strictEqual(clamped.total, 2);
    });

    test("getHistoryForUser() hides other users' and orphan rows", async () => {
        const user1 = R.dispense("user");
        user1.username = "history-user-1";
        await R.store(user1);

        const user2 = R.dispense("user");
        user2.username = "history-user-2";
        await R.store(user2);

        const monitor1 = R.dispense("monitor");
        monitor1.name = "history-monitor-1";
        monitor1.user_id = user1.id;
        monitor1.active = true;
        await R.store(monitor1);

        const monitor2 = R.dispense("monitor");
        monitor2.name = "history-monitor-2";
        monitor2.user_id = user2.id;
        monitor2.active = true;
        await R.store(monitor2);

        await NotificationHistory.record({ monitorID: monitor1.id, message: "mine", success: true });
        await NotificationHistory.record({ monitorID: monitor2.id, message: "theirs", success: true });
        await NotificationHistory.record({ message: "orphan", success: true });

        const result = await NotificationHistory.getHistoryForUser({ userID: user1.id });
        assert.strictEqual(result.total, 1);
        assert.strictEqual(result.rows[0].message, "mine");

        const scoped = await NotificationHistory.getHistoryForUser({ userID: user1.id, monitorID: monitor1.id });
        assert.strictEqual(scoped.total, 1);

        await R.trash(monitor1);
        await R.trash(monitor2);
        await R.trash(user1);
        await R.trash(user2);
    });

    test("clearHistoryForUser() only deletes the scoped rows", async () => {
        await NotificationHistory.record({ monitorID: 20, message: "keep", success: true });
        await NotificationHistory.record({ monitorID: 21, message: "drop", success: true });

        await NotificationHistory.clearHistoryForUser({ userID: 1, monitorID: 21 });

        const remaining = await R.getAll("SELECT * FROM notification_history ORDER BY id ASC");
        assert.strictEqual(remaining.length, 1);
        assert.strictEqual(remaining[0].message, "keep");
    });

    describe("Monitor.sendNotification()", () => {
        test("records a success row per notification", async () => {
            const Monitor = require("../../server/model/monitor");
            const { Notification } = require("../../server/notification");
            const { UptimeKumaServer } = require("../../server/uptime-kuma-server");

            const sendMock = mock.method(Notification, "send", async () => "ok");
            const instanceMock = mock.method(UptimeKumaServer, "getInstance", () => ({
                getTimezone: async () => "UTC",
                getTimezoneOffset: () => "+00:00",
            }));

            try {
                const user = R.dispense("user");
                user.username = "history-sender";
                await R.store(user);

                const monitor = R.dispense("monitor");
                monitor.name = "history-send-monitor";
                monitor.user_id = user.id;
                monitor.active = true;
                await R.store(monitor);

                const notification = R.dispense("notification");
                notification.name = "history-webhook";
                notification.user_id = user.id;
                notification.config = JSON.stringify({ type: "webhook", webhookURL: "http://localhost:1/hook" });
                await R.store(notification);

                const relation = R.dispense("monitor_notification");
                relation.monitor_id = monitor.id;
                relation.notification_id = notification.id;
                await R.store(relation);

                const heartbeat = R.dispense("heartbeat");
                heartbeat.monitor_id = monitor.id;
                heartbeat.status = DOWN;
                heartbeat.msg = "timeout";
                heartbeat.time = R.isoDateTime();
                heartbeat.important = true;
                heartbeat.duration = 0;
                heartbeat.down_count = 1;

                await Monitor.sendNotification(false, monitor, heartbeat);

                assert.strictEqual(sendMock.mock.callCount(), 1);

                const { rows, total } = await NotificationHistory.getHistory({ monitorID: monitor.id });
                assert.strictEqual(total, 1);
                assert.strictEqual(rows[0].notification_id, notification.id);
                assert.strictEqual(rows[0].type, "webhook");
                assert.strictEqual(rows[0].success, 1);
                assert.match(rows[0].message, /history-send-monitor/);

                await R.exec("DELETE FROM monitor_notification WHERE monitor_id = ?", [monitor.id]);
                await R.trash(notification);
                await R.trash(monitor);
                await R.trash(user);
            } finally {
                sendMock.mock.restore();
                instanceMock.mock.restore();
            }
        });

        test("records a failure row when the provider throws", async () => {
            const Monitor = require("../../server/model/monitor");
            const { Notification } = require("../../server/notification");
            const { UptimeKumaServer } = require("../../server/uptime-kuma-server");

            const sendMock = mock.method(Notification, "send", async () => {
                throw new Error("provider exploded");
            });
            const instanceMock = mock.method(UptimeKumaServer, "getInstance", () => ({
                getTimezone: async () => "UTC",
                getTimezoneOffset: () => "+00:00",
            }));

            try {
                const user = R.dispense("user");
                user.username = "history-fail-sender";
                await R.store(user);

                const monitor = R.dispense("monitor");
                monitor.name = "history-fail-monitor";
                monitor.user_id = user.id;
                monitor.active = true;
                await R.store(monitor);

                const notification = R.dispense("notification");
                notification.name = "history-fail-webhook";
                notification.user_id = user.id;
                notification.config = JSON.stringify({ type: "webhook", webhookURL: "http://localhost:1/hook" });
                await R.store(notification);

                const relation = R.dispense("monitor_notification");
                relation.monitor_id = monitor.id;
                relation.notification_id = notification.id;
                await R.store(relation);

                const heartbeat = R.dispense("heartbeat");
                heartbeat.monitor_id = monitor.id;
                heartbeat.status = DOWN;
                heartbeat.msg = "timeout";
                heartbeat.time = R.isoDateTime();
                heartbeat.important = true;
                heartbeat.duration = 0;
                heartbeat.down_count = 1;

                await Monitor.sendNotification(false, monitor, heartbeat);

                const { rows, total } = await NotificationHistory.getHistory({ monitorID: monitor.id });
                assert.strictEqual(total, 1);
                assert.strictEqual(!rows[0].success, true);
                assert.strictEqual(rows[0].error, "provider exploded");

                await R.exec("DELETE FROM monitor_notification WHERE monitor_id = ?", [monitor.id]);
                await R.trash(notification);
                await R.trash(monitor);
                await R.trash(user);
            } finally {
                sendMock.mock.restore();
                instanceMock.mock.restore();
            }
        });
    });
});
