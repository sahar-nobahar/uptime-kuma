process.env.UPTIME_KUMA_HIDE_LOG = ["info_db", "info_server"].join(",");

const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const TestDB = require("../mock-testdb");
const { R } = require("redbean-node");
const { UP, DOWN, PENDING } = require("../../src/util");
const Monitor = require("../../server/model/monitor");

const testDb = new TestDB();

describe("Monitor List Filtering", () => {
    describe("parseMonitorListFilter()", () => {
        test("returns defaults for null input", () => {
            assert.deepStrictEqual(Monitor.parseMonitorListFilter(null), {
                status: null,
                active: null,
                tags: null,
                group: null,
                search: null,
                limit: 200,
                offset: 0,
            });
        });

        test("accepts a full valid filter and dedupes arrays", () => {
            const filter = Monitor.parseMonitorListFilter({
                status: [UP, "0", UP],
                active: [true],
                tags: ["5", 5],
                group: "7",
                search: "  web  ",
                limit: "10",
                offset: "3",
            });
            assert.deepStrictEqual(filter, {
                status: [UP, DOWN],
                active: [true],
                tags: [5],
                group: 7,
                search: "web",
                limit: 10,
                offset: 3,
            });
        });

        test("ignores unknown keys", () => {
            const filter = Monitor.parseMonitorListFilter({ unknown: "x", limit: 5 });
            assert.strictEqual(filter.limit, 5);
        });

        test("clamps an oversized limit", () => {
            assert.strictEqual(Monitor.parseMonitorListFilter({ limit: 5000 }).limit, 1000);
        });

        test("rejects invalid values", () => {
            assert.throws(() => Monitor.parseMonitorListFilter([]), /object/);
            assert.throws(() => Monitor.parseMonitorListFilter({ status: [9] }), /status/);
            assert.throws(() => Monitor.parseMonitorListFilter({ status: ["up"] }), /status/);
            assert.throws(() => Monitor.parseMonitorListFilter({ active: ["yes"] }), /active/);
            assert.throws(() => Monitor.parseMonitorListFilter({ tags: [0] }), /tags/);
            assert.throws(() => Monitor.parseMonitorListFilter({ tags: [1.5] }), /tags/);
            assert.throws(() => Monitor.parseMonitorListFilter({ group: -2 }), /group/);
            assert.throws(() => Monitor.parseMonitorListFilter({ search: 42 }), /search/);
            assert.throws(() => Monitor.parseMonitorListFilter({ limit: 0 }), /limit/);
            assert.throws(() => Monitor.parseMonitorListFilter({ offset: -1 }), /offset/);
        });

        test("escapes LIKE wildcards", () => {
            assert.strictEqual(Monitor.escapeLikeTerm("100%_a\\b"), "100\\%\\_a\\\\b");
        });
    });

    describe("getFilteredMonitorIDs()", () => {
        let user1;
        let user2;
        let activeMonitor;
        let pausedMonitor;
        let groupMonitor;
        let childOne;
        let childTwo;
        let otherUserMonitor;
        let tagID;

        /**
         * Store a heartbeat for a monitor.
         * @param {number} monitorID Monitor ID
         * @param {number} status Heartbeat status
         * @returns {Promise<void>}
         */
        async function addHeartbeat(monitorID, status) {
            const bean = R.dispense("heartbeat");
            bean.monitor_id = monitorID;
            bean.status = status;
            bean.msg = "test";
            bean.time = R.isoDateTime();
            bean.important = false;
            bean.duration = 0;
            bean.down_count = 0;
            await R.store(bean);
        }

        before(async () => {
            await testDb.create();

            user1 = R.dispense("user");
            user1.username = "filter-user-1";
            await R.store(user1);

            user2 = R.dispense("user");
            user2.username = "filter-user-2";
            await R.store(user2);

            activeMonitor = R.dispense("monitor");
            activeMonitor.name = "filter-web-active";
            activeMonitor.user_id = user1.id;
            activeMonitor.active = true;
            await R.store(activeMonitor);

            pausedMonitor = R.dispense("monitor");
            pausedMonitor.name = "filter-web-paused";
            pausedMonitor.user_id = user1.id;
            pausedMonitor.active = false;
            await R.store(pausedMonitor);

            groupMonitor = R.dispense("monitor");
            groupMonitor.name = "filter-group";
            groupMonitor.type = "group";
            groupMonitor.user_id = user1.id;
            groupMonitor.active = true;
            await R.store(groupMonitor);

            childOne = R.dispense("monitor");
            childOne.name = "filter-child-one";
            childOne.user_id = user1.id;
            childOne.active = true;
            childOne.parent = groupMonitor.id;
            await R.store(childOne);

            childTwo = R.dispense("monitor");
            childTwo.name = "filter-child-two";
            childTwo.user_id = user1.id;
            childTwo.active = true;
            childTwo.parent = groupMonitor.id;
            await R.store(childTwo);

            otherUserMonitor = R.dispense("monitor");
            otherUserMonitor.name = "filter-other-user";
            otherUserMonitor.user_id = user2.id;
            otherUserMonitor.active = true;
            await R.store(otherUserMonitor);

            const tag = R.dispense("tag");
            tag.name = "filter-tag";
            tag.color = "#ffffff";
            await R.store(tag);
            tagID = tag.id;

            for (const monitorID of [activeMonitor.id, childOne.id]) {
                const relation = R.dispense("monitor_tag");
                relation.monitor_id = monitorID;
                relation.tag_id = tagID;
                await R.store(relation);
            }

            // activeMonitor: stale DOWN, then UP (latest wins)
            await addHeartbeat(activeMonitor.id, DOWN);
            await addHeartbeat(activeMonitor.id, UP);
            await addHeartbeat(pausedMonitor.id, DOWN);
            await addHeartbeat(childOne.id, PENDING);
            await addHeartbeat(otherUserMonitor.id, DOWN);
        });

        after(async () => {
            const { Settings } = require("../../server/settings");
            Settings.stopCacheCleaner();
            await testDb.destroy();
        });

        test("filters by latest heartbeat status", async () => {
            const up = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ status: [UP] })
            );
            assert.ok(up.ids.includes(activeMonitor.id));
            assert.ok(!up.ids.includes(pausedMonitor.id));

            const down = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ status: [DOWN] })
            );
            assert.ok(down.ids.includes(pausedMonitor.id));
            assert.ok(!down.ids.includes(activeMonitor.id));

            // Monitors without any heartbeat never match a status filter
            assert.ok(!up.ids.includes(childTwo.id));
            assert.ok(!down.ids.includes(childTwo.id));
        });

        test("filters by active flag", async () => {
            const active = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ active: [true] })
            );
            assert.ok(active.ids.includes(activeMonitor.id));
            assert.ok(!active.ids.includes(pausedMonitor.id));

            const paused = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ active: [false] })
            );
            assert.deepStrictEqual(paused.ids, [pausedMonitor.id]);
        });

        test("filters by tag", async () => {
            const result = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ tags: [tagID] })
            );
            assert.ok(result.ids.includes(activeMonitor.id));
            assert.ok(result.ids.includes(childOne.id));
            assert.ok(!result.ids.includes(childTwo.id));
        });

        test("filters by group (direct children only)", async () => {
            const result = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ group: groupMonitor.id })
            );
            assert.deepStrictEqual(new Set(result.ids), new Set([childOne.id, childTwo.id]));
        });

        test("rejects a group owned by another user", async () => {
            await assert.rejects(
                async () =>
                    await Monitor.getFilteredMonitorIDs(
                        user2.id,
                        Monitor.parseMonitorListFilter({ group: groupMonitor.id })
                    ),
                /access denied/
            );
        });

        test("filters by name search", async () => {
            const result = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ search: "child-one" })
            );
            assert.deepStrictEqual(result.ids, [childOne.id]);
        });

        test("search treats LIKE wildcards literally", async () => {
            const result = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ search: "filter%child" })
            );
            assert.deepStrictEqual(result.ids, []);
            assert.strictEqual(result.total, 0);
        });

        test("never leaks another user's monitors", async () => {
            const result = await Monitor.getFilteredMonitorIDs(user1.id, Monitor.parseMonitorListFilter({}));
            assert.ok(!result.ids.includes(otherUserMonitor.id));
            assert.strictEqual(result.total, 5);
        });

        test("paginates with limit/offset and reports the total", async () => {
            const page1 = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ limit: 2, offset: 0 })
            );
            assert.strictEqual(page1.total, 5);
            assert.strictEqual(page1.ids.length, 2);

            const page2 = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ limit: 2, offset: 2 })
            );
            assert.strictEqual(page2.total, 5);
            assert.strictEqual(page2.ids.length, 2);
            assert.deepStrictEqual(
                new Set([...page1.ids, ...page2.ids]).size,
                4
            );
        });

        test("combines status, tag and search filters", async () => {
            const result = await Monitor.getFilteredMonitorIDs(
                user1.id,
                Monitor.parseMonitorListFilter({ status: [UP], tags: [tagID], search: "web-active" })
            );
            assert.deepStrictEqual(result.ids, [activeMonitor.id]);
        });
    });

    describe("getMonitorJSONList() with ID restriction", () => {
        test("returns only the requested monitors and {} for an empty list", async () => {
            const { UptimeKumaServer } = require("../../server/uptime-kuma-server");
            // getMonitorJSONList uses no instance state, so call it without
            // booting a server (which would require dist/index.html).
            const getMonitorJSONList = UptimeKumaServer.prototype.getMonitorJSONList;

            const user = await R.findOne("user", " username = ? ", ["filter-user-1"]);
            const monitors = await R.getAll("SELECT id FROM monitor WHERE user_id = ? ORDER BY id", [user.id]);
            const ids = monitors.map((row) => row.id);

            const partial = await getMonitorJSONList.call({}, user.id, null, [ids[0]]);
            assert.deepStrictEqual(
                Object.keys(partial).map((id) => parseInt(id, 10)),
                [ids[0]]
            );

            const empty = await getMonitorJSONList.call({}, user.id, null, []);
            assert.deepStrictEqual(empty, {});
        });
    });
});
