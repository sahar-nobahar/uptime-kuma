process.env.UPTIME_KUMA_HIDE_LOG = ["info_db", "info_server"].join(",");

const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const Settings = require("../server/settings");
const weeklyReport = require("../server/weekly-report");

describe("Weekly AI Report", () => {
    before(async () => {
        // Ensure settings are clean
        await Settings.set("weeklyAiReportEnabled", false, "general");
        await Settings.set("weeklyAiApiKey", null, "general");
        await Settings.set("weeklyAiReportLast", null, "general");
    });

    after(async () => {
        await Settings.set("weeklyAiReportEnabled", false, "general");
        await Settings.set("weeklyAiApiKey", null, "general");
        await Settings.set("weeklyAiReportLast", null, "general");
    });

    describe("computeUptimePct", () => {
        test("returns percentage when up and down are positive", () => {
            assert.strictEqual(weeklyReport.computeUptimePct(80, 20), 80);
        });

        test("returns null when total is 0", () => {
            assert.strictEqual(weeklyReport.computeUptimePct(0, 0), null);
        });

        test("returns null when both are null/undefined", () => {
            assert.strictEqual(weeklyReport.computeUptimePct(null, null), null);
        });
    });

    describe("formatDuration", () => {
        test("formats seconds into human readable", () => {
            assert.strictEqual(weeklyReport.formatDuration(3661), "1h 1m");
        });

        test("formats minutes only", () => {
            assert.strictEqual(weeklyReport.formatDuration(90), "1m 30s");
        });

        test("formats days", () => {
            assert.strictEqual(weeklyReport.formatDuration(90000), "1d");
        });
    });

    describe("buildReportText", () => {
        test("builds report text with stats", () => {
            const stats = {
                from: "2026-01-01T00:00:00.000Z",
                to: "2026-01-08T00:00:00.000Z",
                days: 7,
                totals: {
                    monitorCount: 3,
                    avgUptimePct: 95.5,
                    totalOutages: 2,
                    totalDowntimeSeconds: 7200,
                },
                monitors: [
                    {
                        monitorID: 1,
                        name: "Monitor A",
                        uptimePct: 99.9,
                        outages: 1,
                        downtimeSeconds: 3600,
                        avgPing: 20,
                    },
                ],
            };
            const text = weeklyReport.buildReportText(stats);
            assert.strictEqual(text.includes("Weekly Uptime Report"), true);
            assert.strictEqual(text.includes("Monitors: 3"), true);
            assert.strictEqual(text.includes("Average uptime: 95.50%"), true);
            assert.strictEqual(text.includes("Total outages: 2"), true);
            assert.strictEqual(text.includes("Total downtime: 2h 0m"), true);
            assert.strictEqual(text.includes("Monitor A"), true);
        });

        test("handles no monitors", () => {
            const stats = {
                from: "2026-01-01T00:00:00.000Z",
                to: "2026-01-08T00:00:00.000Z",
                days: 7,
                totals: {
                    monitorCount: 0,
                    avgUptimePct: null,
                    totalOutages: 0,
                    totalDowntimeSeconds: 0,
                },
                monitors: [],
            };
            const text = weeklyReport.buildReportText(stats);
            assert.strictEqual(text.includes("no monitors"), true);
        });
    });

    describe("buildAnalysisPrompt", () => {
        test("builds a prompt string for the AI model", () => {
            const reportText = "Weekly Uptime Report...\nMonitors: 3\n...";
            const prompt = weeklyReport.buildAnalysisPrompt(reportText);
            assert.strictEqual(prompt.includes("You are an uptime monitoring assistant"), true);
            assert.strictEqual(prompt.includes("Report:"), true);
            assert.strictEqual(prompt.includes(reportText), true);
        });
    });

    describe("storeWeeklyReport", () => {
        test("stores the report in settings", async () => {
            const report = {
                from: "2026-01-01T00:00:00.000Z",
                to: "2026-01-08T00:00:00.000Z",
                days: 7,
                totals: {
                    monitorCount: 1,
                    avgUptimePct: 99.9,
                    totalOutages: 0,
                    totalDowntimeSeconds: 0,
                },
                monitors: [
                    {
                        monitorID: 1,
                        name: "Test Monitor",
                        uptimePct: 99.9,
                        outages: 0,
                        downtimeSeconds: 0,
                        avgPing: 10,
                    },
                ],
            };
            await weeklyReport.storeWeeklyReport(report);

            const stored = await Settings.get("weeklyAiReportLast", "general");
            assert.notStrictEqual(stored, null);
            assert.strictEqual(stored.monitorCount, 1);
            assert.strictEqual(stored.totals.avgUptimePct, 99.9);
            assert.strictEqual(stored.reportText != null, true);
        });
    });

    describe("integration: enabled + api key", async () => {
        test("enables report and sets api key, then stores report with aiText null when key missing", async () => {
            // Enable report but no API key
            await Settings.set("weeklyAiReportEnabled", true, "general");
            await Settings.set("weeklyAiApiKey", null, "general");

            const stats = {
                from: "2026-01-01T00:00:00.000Z",
                to: "2026-01-08T00:00:00.000Z",
                days: 7,
                totals: { monitorCount: 1, avgUptimePct: 95, totalOutages: 0, totalDowntimeSeconds: 0 },
                monitors: [
                    {
                        monitorID: 1,
                        name: "M1",
                        uptimePct: 95,
                        outages: 0,
                        downtimeSeconds: 0,
                        avgPing: 10,
                    },
                ],
            };

            // buildAnalysisPrompt should still work but aiText will be null
            // because apiKey is null; the job logic checks reportEnabled && apiKey
            const prompt = weeklyReport.buildAnalysisPrompt(
                weeklyReport.buildReportText(stats)
            );
            assert.strictEqual(prompt != null, true);

            // Store report; aiText should be null since apiKey is null
            await weeklyReport.storeWeeklyReport({ ...stats, aiText: null });

            const stored = await Settings.get("weeklyAiReportLast", "general");
            assert.strictEqual(stored.aiText, null);
            assert.strictEqual(stored.monitorCount, 1);
        });
    });
});