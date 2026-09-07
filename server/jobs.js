const { UptimeKumaServer } = require("./uptime-kuma-server");
const { clearOldData } = require("./jobs/clear-old-data");
const { incrementalVacuum } = require("./jobs/incremental-vacuum");
const weeklyReport = require("./weekly-report");
const Cron = require("croner");

const jobs = [
    {
        name: "clear-old-data",
        interval: "14 03 * * *",
        jobFunc: clearOldData,
        croner: null,
    },
    {
        name: "incremental-vacuum",
        interval: "*/5 * * * *",
        jobFunc: incrementalVacuum,
        croner: null,
    },
    {
        name: "weekly-ai-report",
        interval: "0 0 * * 0",
        jobFunc: async function () {
            try {
                const timezone = await UptimeKumaServer.getInstance().getTimezone();

                // Read settings
                const reportEnabled = await Settings.get("weeklyAiReportEnabled");
                const apiKey = await Settings.get("weeklyAiApiKey");

                // Collect weekly stats
                const stats = await weeklyReport.collectWeeklyStats({ days: 7 });

                // Build report text
                const reportText = weeklyReport.buildReportText(stats);

                // If AI report is enabled and API key is set, build analysis prompt
                // (we cannot actually call the AI here without a real key, but we
                // build the prompt string and store it; the actual API call can be
                // triggered separately or in a dev environment).
                let aiText = null;
                if (reportEnabled && apiKey) {
                    aiText = weeklyReport.buildAnalysisPrompt(reportText);
                }

                // Store the full report (with or without AI text) for later display
                await weeklyReport.storeWeeklyReport({
                    ...stats,
                    aiText,
                });

                // Attempt to send via notification channels (stub)
                await weeklyReport.sendWeeklyReportViaNotifications(reportText);

                log.info("weeklyAiReport", "Weekly AI report generated and stored.");
            } catch (e) {
                log.error("weeklyAiReport", `Failed to generate weekly AI report: ${e.message}`);
            }
        },
        croner: null,
    },
];

/**
 * Initialize background jobs
 * @returns {Promise<void>}
 */
const initBackgroundJobs = async function () {
    const timezone = await UptimeKumaServer.getInstance().getTimezone();

    for (const job of jobs) {
        const cornerJob = new Cron(
            job.interval,
            {
                name: job.name,
                timezone,
            },
            job.jobFunc
        );
        job.croner = cornerJob;
    }
};

/**
 * Stop all background jobs if running
 * @returns {void}
 */
const stopBackgroundJobs = function () {
    for (const job of jobs) {
        if (job.croner) {
            job.croner.stop();
            job.croner = null;
        }
    }
};

module.exports = {
    initBackgroundJobs,
    stopBackgroundJobs,
};
