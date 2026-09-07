const { R } = require("redbean-node");
const { log, UP, DOWN } = require("../src/util");
const dayjs = require("dayjs");
dayjs.extend(require("dayjs/plugin/utc"));
const { Settings } = require("./settings");
const { Notification } = require("../notification");

const REPORT_WINDOW_DAYS = 7;

/**
 * Store the weekly report in a setting for later retrieval/display.
 * @param {object} report The report object from collectWeeklyStats.
 * @param {string} [report.aiText] Optional AI-generated analysis text.
 */
async function storeWeeklyReport(report) {
    const reportText = buildReportText(report);
    const aiText = report.aiText || null;
    const payload = {
        from: report.from,
        to: report.to,
        days: report.days,
        monitorCount: report.totals.monitorCount,
        avgUptimePct: report.totals.avgUptimePct,
        totalOutages: report.totals.totalOutages,
        totalDowntimeSeconds: report.totals.totalDowntimeSeconds,
        reportText,
        aiText,
    };
    await Settings.set("weeklyAiReportLast", payload, "general");
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

/**
 * Attempt to send the weekly report via notification channels.
 * Currently a stub: stores the report text and logs.
 * In a full implementation, this would iterate over configured notification
 * providers (email, Telegram, etc.) and send the report message.
 * @param {string} reportText The plain-text report to send.
 * @returns {Promise<void>}
 */
async function sendWeeklyReportViaNotifications(reportText) {
    // Stub: for now, just log and store the intent.
    // A full implementation would use the Notification module to send
    // the report through each configured provider.
    log.info("weeklyAiReport", "Sending weekly report via notification channels (stub)");
    // Example future implementation:
    // const apiKey = await Settings.get("weeklyAiApiKey");
    // if (apiKey) {
    //     // send via Telegram, email, etc.
    // }
    await Settings.set("weeklyAiReportSent", true, "general");
}

module.exports = {
    REPORT_WINDOW_DAYS,
    computeUptimePct,
    formatDuration,
    getReportWindow,
    collectWeeklyStats,
    buildReportText,
    buildAnalysisPrompt,
    storeWeeklyReport,
    sendWeeklyReportViaNotifications,
};
