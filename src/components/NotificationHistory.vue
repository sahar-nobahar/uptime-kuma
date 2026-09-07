<template>
    <div class="shadow-box table-shadow-box">
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="mb-0">{{ $t("Notification History") }}</h6>
            <button class="btn btn-sm btn-outline-primary" type="button" @click="fetchHistory">
                {{ $t("Refresh") }}
            </button>
        </div>
        <table class="table table-borderless table-hover">
            <thead>
                <tr>
                    <th>{{ $t("Status") }}</th>
                    <th>{{ $t("Notification") }}</th>
                    <th>{{ $t("Message") }}</th>
                    <th>{{ $t("DateTime") }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="entry in entries" :key="entry.id" style="padding: 10px">
                    <td>
                        <span v-if="entry.success" class="badge bg-success">{{ $t("Sent") }}</span>
                        <span v-else class="badge bg-danger" :title="entry.error || ''">{{ $t("Failed") }}</span>
                    </td>
                    <td>
                        {{ entry.notification_name || entry.notificationName || entry.type || "-" }}
                    </td>
                    <td class="border-0">{{ entry.message }}</td>
                    <td :class="{ 'border-0': !entry.message }">
                        <Datetime :value="entry.created_date || entry.createdDate" />
                    </td>
                </tr>
                <tr v-if="entries.length === 0">
                    <td colspan="4">
                        {{ $t("No notification history") }}
                    </td>
                </tr>
            </tbody>
        </table>
        <div v-if="total > perPage" class="d-flex justify-content-center kuma_pagination">
            <pagination v-model="page" :records="total" :per-page="perPage" :options="paginationConfig" />
        </div>
    </div>
</template>

<script>
import Pagination from "v-pagination-3";
import Datetime from "./Datetime.vue";

export default {
    components: {
        Pagination,
        Datetime,
    },
    props: {
        /** Monitor id to load notification history for */
        monitorId: {
            type: Number,
            default: null,
        },
    },
    data() {
        return {
            entries: [],
            total: 0,
            page: 1,
            perPage: 10,
            paginationConfig: {
                texts: {
                    count: "",
                },
            },
        };
    },
    watch: {
        monitorId() {
            this.page = 1;
            this.fetchHistory();
        },
        page() {
            this.fetchHistory();
        },
    },
    mounted() {
        this.fetchHistory();
    },
    methods: {
        /**
         * Load one page of notification history for the monitor.
         * @returns {void}
         */
        fetchHistory() {
            if (this.monitorId == null) {
                return;
            }
            const offset = (this.page - 1) * this.perPage;
            this.$root.getSocket().emit(
                "getNotificationHistory",
                {
                    monitorID: this.monitorId,
                    limit: this.perPage,
                    offset,
                },
                (res) => {
                    if (res && res.ok) {
                        this.entries = res.data;
                        this.total = res.total;
                    }
                }
            );
        },
    },
};
</script>
