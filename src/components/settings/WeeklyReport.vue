<template>
    <div class="shadow-box p-4">
        <h2 class="mb-3">{{ $t("Weekly AI Report") }}</h2>

        <div v-if="!report">
            <p>{{ $t("No weekly report generated yet.") }}</p>
            <p>
                <a :href="`/settings/general`">{{ $t("Generate report") }}</a>
                by enabling the feature in General settings.
            </p>
        </div>

        <div v-if="report">
            <div class="mb-3">
                <strong>{{ $t("Period") }}:</strong>
                {{ report.from ? dayjs(report.from).format("YYYY-MM-DD") : "?" }} — {{ report.to ? dayjs(report.to).format("YYYY-MM-DD") : "?" }}
            </div>

            <div v-if="report.reportText" class="mb-3">
                <strong>{{ $t("Statistical Report") }}:</strong><br />
                <pre class="mt-2 small" style="white-space: pre-wrap; background: #f8f9fa; padding: 10px; border-radius: 4%;">{{ report.reportText }}</pre>
            </div>

            <div v-if="report.aiText" class="mb-3">
                <strong>{{ $t("AI Analysis") }}:</strong><br />
                <pre class="mt-2 small" style="white-space: pre-wrap; background: #e9ecef; padding: 10px; border-radius: 4%;">{{ report.aiText }}</pre>
            </div>

            <v-card-text v-if="!report.aiText">
                <small class="text-muted">{{ $t("AI analysis disabled. Set API key and enable report in General settings.") }}</small>
            </v-card-text>
        </div>
    </div>
</template>

<script>
export default {
    props: {
        report: {
            type: Object,
            default: null,
        },
    },
};
</script>

<style scoped>
.small {
    font-size: 0.85em;
}
</style>