const { R } = require("redbean-node");
const { log, UP, DOWN } = require("../src/util");
const dayjs = require("dayjs");
dayjs.extend(require("dayjs/plugin/utc"));

const REPORT_WINDOW_DAYS = 7;

/**
 * Compute uptime percentage from up/down counters.
 * @param {number} up Up counter
 * @param {number} down Down counter
 * @returns {number|null} Percentage 0..100, or null when there is no data
 */
function computeUptimePct(up, down) {
    const total = (up || 0) + (down || 0);
    if (total <= 0) {
        return null;
    }
    return ((up || 0) / total) * 100;
}

/**
 * Format a duration in seconds as a short human string.
 * @param {number} seconds Duration in seconds
 * @returns {string} e.g. "2h 5m", "45s", "3d 1h"
 */
function formatDuration(seconds) {
    const total = Math.max(0, Math.round(seconds || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (days > 0) {
        return `${days}d ${hours}h`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
}

/**
 * Get the report window (last N full days, UTC).
 * @param {number} days Window length in days
 * @param {object} now Reference time (dayjs-compatible)
 * @returns {{from: object, to: object}} Window boundaries (dayjs, UTC)
 */
function getReportWindow(days = REPORT_WINDOW_DAYS, now = dayjs.utc()) {
    const to = dayjs.utc(now).startOf("day");
    const from = to.subtract(days, "day");
    return { from, to };
}

/**
 * Collect per-monitor weekly stats from existing data.
 * Uptime comes from the stat_daily aggregates; outage count and downtime
 * come from heartbeats (important DOWN beats mark outage starts, and the
 * duration column holds seconds since the previous beat).
 * @param {object} opts Options
 * @param {number} opts.days Window length in days (default 7)
 * @returns {Promise<object>} { from, to, monitors: [...], totals: {...} }
 */
async function collectWeeklyStats({ days = REPORT_WINDOW_DAYS } = {}) {
    const { from, to } = getReportWindow(days);
    const fromSQL = from.format("YYYY-MM-DD HH:mm:ss");
    const toSQL = to.format("YYYY-MM-DD HH:mm:ss");
    const fromUnix = from.unix();

    const monitors = await R.getAll("SELECT id, name FROM monitor ORDER BY name");

    const statRows = await R.getAll(
        `SELECT monitor_id,
            SUM(up) AS up, SUM(down) AS down
         FROM stat_daily
         WHERE timestamp >= ?
         GROUP BY monitor_id`,
        [fromUnix]
    );
    const statByMonitor = new Map(statRows.map((row) => [row.monitor_id, row]));

    const heartbeatAgg = await R.getAll(
        `SELECT monitor_id,
            SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS up_beats,
            SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS down_beats,
            SUM(CASE WHEN status = ? AND important = 1 THEN 1 ELSE 0 END) AS outages,
            SUM(CASE WHEN status = ? THEN duration ELSE 0 END) AS downtime_seconds,
            AVG(ping) AS avg_ping
         FROM heartbeat
         WHERE time >= ? AND time < ?
         GROUP BY monitor_id`,
        [UP, DOWN, DOWN, DOWN, fromSQL, toSQL]
    );
    const heartbeatByMonitor = new Map(heartbeatAgg.map((row) => [row.monitor_id, row]));

    const result = [];
    for (const monitor of monitors) {
        const stat = statByMonitor.get(monitor.id);
        const beats = heartbeatByMonitor.get(monitor.id);

        let uptimePct = null;
        if (stat && (Number(stat.up) > 0 || Number(stat.down) > 0)) {
            uptimePct = computeUptimePct(Number(stat.up), Number(stat.down));
        } else if (beats && (Number(beats.up_beats) > 0 || Number(beats.down_beats) > 0)) {
            // Fallback for new monitors without daily aggregates yet
            uptimePct = computeUptimePct(Number(beats.up_beats), Number(beats.down_beats));
        }

        result.push({
            monitorID: monitor.id,
            name: monitor.name,
            uptimePct,
            outages: beats ? Number(beats.outages) || 0 : 0,
            downtimeSeconds: beats ? Number(beats.downtime_seconds) || 0 : 0,
            avgPing: beats && beats.avg_ping != null ? Math.round(Number(beats.avg_ping)) : null,
        });
    }

    const withData = result.filter((item) => item.uptimePct != null);
    const totals = {
        monitorCount: result.length,
        avgUptimePct:
            withData.length > 0
                ? withData.reduce((sum, item) => sum + item.uptimePct, 0) / withData.length
                : null,
        totalOutages: result.reduce((sum, item) => sum + item.outages, 0),
        totalDowntimeSeconds: result.reduce((sum, item) => sum + item.downtimeSeconds, 0),
    };

    return {
        from: from.toISOString(),
        to: to.toISOString(),
        days,
        monitors: result,
        totals,
    };
}

/**
 * Render the stats as a plain-text report (no AI needed).
 * @param {object} stats Stats from collectWeeklyStats
 * @returns {string} Report text
 */
function buildReportText(stats) {
    const from = dayjs.utc(stats.from).format("YYYY-MM-DD");
    const to = dayjs.utc(stats.to).format("YYYY-MM-DD");
    const lines = [`Weekly Uptime Report (${from} to ${to})`, ""];

    const totals = stats.totals;
    lines.push(`Monitors: ${totals.monitorCount}`);
    lines.push(
        `Average uptime: ${totals.avgUptimePct != null ? totals.avgUptimePct.toFixed(2) + "%" : "no data"}`
    );
    lines.push(`Total outages: ${totals.totalOutages}`);
    lines.push(`Total downtime: ${formatDuration(totals.totalDowntimeSeconds)}`);
    lines.push("");
    lines.push("Per-monitor:");

    if (stats.monitors.length === 0) {
        lines.push("- (no monitors)");
    }
    for (const monitor of stats.monitors) {
        const uptime = monitor.uptimePct != null ? `${monitor.uptimePct.toFixed(2)}%` : "no data";
        const ping = monitor.avgPing != null ? `, avg ping ${monitor.avgPing}ms` : "";
        lines.push(
            `- ${monitor.name}: uptime ${uptime}, outages ${monitor.outages}, downtime ${formatDuration(
                monitor.downtimeSeconds
            )}${ping}`
        );
    }

    return lines.join("\n");
}

/**
 * Build the prompt sent to the AI model: status summary + notable points.
 * @param {string} reportText Stats report from buildReportText
 * @returns {string} Prompt text
 */
function buildAnalysisPrompt(reportText) {
    return [
        "You are an uptime monitoring assistant. Below is a weekly uptime report.",
        "Write a short status summary (2-4 sentences) followed by bullet points",
        "with the most notable observations (worst monitors, repeated outages,",
        "long downtimes). Keep it concise and factual, no preamble.",
        "",
        "Report:",
        reportText,
    ].join("\n");
}

module.exports = {
    REPORT_WINDOW_DAYS,
    computeUptimePct,
    formatDuration,
    getReportWindow,
    collectWeeklyStats,
    buildReportText,
    buildAnalysisPrompt,
};
