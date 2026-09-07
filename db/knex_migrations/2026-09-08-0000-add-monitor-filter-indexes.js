// Adds indexes used by server-side monitor list filtering.
// monitor and monitor_tag are low-write tables, so the extra indexes are cheap.
// heartbeat is intentionally left untouched: it already has a monitor_id index
// and sits on the hot insert path of every check interval.
exports.up = function (knex) {
    return knex.schema
        .table("monitor", function (table) {
            table.index("user_id", "monitor_user_id");
            table.index("parent", "monitor_parent");
        })
        .table("monitor_tag", function (table) {
            table.index("monitor_id", "monitor_tag_monitor_id");
            table.index("tag_id", "monitor_tag_tag_id");
            table.index(["monitor_id", "tag_id"], "monitor_tag_monitor_tag");
        });
};

exports.down = function (knex) {
    return knex.schema
        .table("monitor_tag", function (table) {
            table.dropIndex(["monitor_id", "tag_id"], "monitor_tag_monitor_tag");
            table.dropIndex("tag_id", "monitor_tag_tag_id");
            table.dropIndex("monitor_id", "monitor_tag_monitor_id");
        })
        .table("monitor", function (table) {
            table.dropIndex("parent", "monitor_parent");
            table.dropIndex("user_id", "monitor_user_id");
        });
};
