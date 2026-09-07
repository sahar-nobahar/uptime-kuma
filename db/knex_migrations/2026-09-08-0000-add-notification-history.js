exports.up = function (knex) {
    return knex.schema.createTable("notification_history", function (table) {
        table.increments("id");
        table.integer("notification_id").unsigned().nullable();
        table.integer("monitor_id").unsigned().nullable();
        table.string("type", 50).nullable();
        table.string("notification_name", 255).nullable();
        table.text("message").nullable();
        table.boolean("success").notNullable().defaultTo(true);
        table.text("error").nullable();
        table.datetime("created_date").notNullable().defaultTo(knex.fn.now());

        table.index("monitor_id", "notification_history_monitor_id");
        table.index("notification_id", "notification_history_notification_id");
        table.index("created_date", "notification_history_created_date");
        table.index(["monitor_id", "created_date"], "notification_history_monitor_created");
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists("notification_history");
};
