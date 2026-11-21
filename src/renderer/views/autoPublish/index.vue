<template>
  <div class="page-shell auto-publish-page">
    <div class="page-header">
      <h1 class="page-title">AI 定时发帖</h1>
      <p class="page-desc">
        使用 xAI 生成本地图文并定时发布。仅当<strong>本应用正在运行</strong>时才会触发调度；退出后不执行。
        漏跑不补发，仅跳到下一档。默认不开启正式发帖，需分别启用任务并勾选「允许正式自动发布」。
      </p>
    </div>

    <xai-settings-panel class="section-block" />

    <el-card shadow="never" class="section-block">
      <div slot="header" class="toolbar">
        <span>定时任务</span>
        <el-button type="primary" size="small" icon="el-icon-plus" @click="openEditor()">
          新建任务
        </el-button>
      </div>
      <el-table :data="tasks" border size="small" v-loading="loading">
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column prop="pt" label="平台" width="72" />
        <el-table-column prop="phone" label="账号" min-width="140" show-overflow-tooltip />
        <el-table-column label="调度" min-width="160">
          <template slot-scope="{ row }">
            <span v-if="row.schedule && row.schedule.type === 'daily'">
              每日 {{ dailyLabel(row.schedule.dailyTime) }}（上海）
            </span>
            <span v-else>{{ row.schedule && row.schedule.onceAt }}</span>
          </template>
        </el-table-column>
        <el-table-column label="下次执行" width="168">
          <template slot-scope="{ row }">
            {{ row.nextRunAtText || "—" }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template slot-scope="{ row }">
            <el-tag v-if="row.enabled" type="success" size="mini">已启用</el-tag>
            <el-tag v-else type="info" size="mini">已暂停</el-tag>
            <el-tag v-if="row.allowRealPublish" type="danger" size="mini" class="ml-4">正式发帖</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template slot-scope="{ row }">
            <el-button type="text" size="mini" @click="openEditor(row)">编辑</el-button>
            <el-button type="text" size="mini" @click="toggleEnabled(row)">
              {{ row.enabled ? "暂停" : "启用" }}
            </el-button>
            <el-button type="text" size="mini" :disabled="!row.enabled" @click="runNow(row)">
              立即执行
            </el-button>
            <el-button type="text" size="mini" class="danger-text" @click="removeTask(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="section-block">
      <div slot="header">执行历史</div>
      <el-table :data="runs" border size="small" max-height="360">
        <el-table-column label="时间" width="168">
          <template slot-scope="{ row }">{{ formatTs(row.startedAt) }}</template>
        </el-table-column>
        <el-table-column prop="taskName" label="任务" min-width="100" />
        <el-table-column prop="status" label="结果" width="120" />
        <el-table-column prop="message" label="说明" min-width="200" show-overflow-tooltip />
        <el-table-column prop="contentPreview" label="正文预览" min-width="120" show-overflow-tooltip />
      </el-table>
    </el-card>

    <el-dialog
      :visible.sync="editorVisible"
      :title="editing.id ? '编辑任务' : '新建任务'"
      width="640px"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-form label-width="128px" size="small">
        <el-form-item label="任务名称" required>
          <el-input v-model="editing.name" maxlength="80" />
        </el-form-item>
        <el-form-item label="平台">
          <el-select v-model="editing.pt" style="width: 100%">
            <el-option label="头条（微头条）" value="头条" />
          </el-select>
        </el-form-item>
        <el-form-item label="发布账号" required>
          <el-select v-model="editing.phone" filterable placeholder="选择头条账号" style="width: 100%">
            <el-option
              v-for="acc in ttAccounts"
              :key="acc.phone"
              :label="acc.label"
              :value="acc.phone"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="选题 / 提示词" required>
          <el-input
            v-model="editing.topicPrompt"
            type="textarea"
            :rows="4"
            placeholder="描述要写什么；涉及时事请附上可核实素材，否则将生成观点型短帖"
          />
        </el-form-item>
        <el-form-item label="配图提示词">
          <el-input v-model="editing.imagePrompt" type="textarea" :rows="2" placeholder="留空则根据选题自动生成" />
        </el-form-item>
        <el-form-item label="生成配图">
          <el-switch v-model="editing.generateImage" />
        </el-form-item>
        <el-form-item label="调度类型">
          <el-radio-group v-model="editing.schedule.type">
            <el-radio label="once">一次性</el-radio>
            <el-radio label="daily">每日重复</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="editing.schedule.type === 'once'" label="执行时间" required>
          <el-date-picker
            v-model="editing.oncePicker"
            type="datetime"
            value-format="yyyy-MM-dd HH:mm:ss"
            placeholder="上海时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item v-else label="每日时刻" required>
          <el-time-picker
            v-model="editing.dailyPicker"
            value-format="HH:mm:ss"
            placeholder="上海时间"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="截止日期">
          <el-date-picker
            v-model="editing.schedule.endDate"
            type="date"
            value-format="yyyy-MM-dd"
            placeholder="可选"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="最多执行次数">
          <el-input-number v-model="editing.schedule.maxRuns" :min="1" :max="9999" placeholder="不限" />
        </el-form-item>
        <el-form-item label="启用任务">
          <el-switch v-model="editing.enabled" />
          <span class="form-tip">新建任务默认关闭；启用后仍需应用保持打开</span>
        </el-form-item>
        <el-form-item label="正式自动发布">
          <el-switch v-model="editing.allowRealPublish" />
          <span class="form-tip danger">关闭时仅调用 xAI 生成，不向平台发帖</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveTask">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import XaiSettingsPanel from "@/components/autoPublish/XaiSettingsPanel.vue";
import dataRequest from "@/utils/dataRequest";
import {
  listAutoPublish,
  saveAutoPublishTask,
  removeAutoPublishTask,
  setAutoPublishEnabled,
  runAutoPublishNow,
  onAutoPublishChanged,
} from "@/utils/autoPublish";

function blankTask() {
  return {
    id: "",
    name: "",
    pt: "头条",
    phone: "",
    textType: "weitoutiao",
    topicPrompt: "",
    imagePrompt: "",
    generateImage: true,
    schedule: { type: "once", onceAt: "", dailyTime: "10:00:00", endDate: "", maxRuns: null },
    enabled: false,
    allowRealPublish: false,
    oncePicker: "",
    dailyPicker: "10:00:00",
  };
}

export default {
  name: "AutoPublishPage",
  components: { XaiSettingsPanel },
  data() {
    return {
      loading: false,
      saving: false,
      tasks: [],
      runs: [],
      ttAccounts: [],
      editorVisible: false,
      editing: blankTask(),
      _offChanged: null,
    };
  },
  created() {
    this.loadAccounts();
    this.refresh();
    this._offChanged = onAutoPublishChanged(() => this.refresh());
  },
  beforeDestroy() {
    if (this._offChanged) this._offChanged();
  },
  methods: {
    dailyLabel(t) {
      return String(t || "10:00:00").replace(/^(\d{2}:\d{2})(?::\d{2})?$/, "$1");
    },
    formatTs(ms) {
      if (!ms) return "—";
      return new Date(ms).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    },
    async loadAccounts() {
      try {
        const res = await dataRequest({ type: "get", fileName: "account", item: {} });
        const rows = (res && res.data) || [];
        this.ttAccounts = rows
          .filter((a) => String(a.pt || "") === "头条")
          .map((a) => ({
            phone: a.phone,
            label: a.phone,
          }));
      } catch (_) {
        this.ttAccounts = [];
      }
    },
    applyList(payload) {
      this.tasks = payload.tasks || [];
      this.runs = payload.runs || [];
    },
    async refresh() {
      this.loading = true;
      try {
        this.applyList(await listAutoPublish());
      } catch (e) {
        this.$message.error(e.message);
      } finally {
        this.loading = false;
      }
    },
    openEditor(row) {
      if (row) {
        this.editing = {
          ...blankTask(),
          ...JSON.parse(JSON.stringify(row)),
          oncePicker: row.schedule && row.schedule.onceAt ? row.schedule.onceAt : "",
          dailyPicker: (row.schedule && row.schedule.dailyTime) || "10:00:00",
        };
      } else {
        this.editing = blankTask();
      }
      this.editorVisible = true;
    },
    buildPayload() {
      const e = this.editing;
      const schedule = {
        type: e.schedule.type,
        endDate: e.schedule.endDate || "",
        maxRuns: e.schedule.maxRuns || null,
      };
      if (schedule.type === "once") {
        schedule.onceAt = e.oncePicker || "";
      } else {
        schedule.dailyTime = e.dailyPicker || "10:00:00";
      }
      return {
        id: e.id || undefined,
        name: e.name,
        pt: e.pt,
        phone: e.phone,
        textType: "weitoutiao",
        topicPrompt: e.topicPrompt,
        imagePrompt: e.imagePrompt,
        generateImage: e.generateImage,
        schedule,
        enabled: e.enabled === true,
        allowRealPublish: e.allowRealPublish === true,
      };
    },
    async saveTask() {
      this.saving = true;
      try {
        const res = await saveAutoPublishTask(this.buildPayload());
        this.applyList(res);
        this.editorVisible = false;
        this.$message.success("任务已保存");
      } catch (e) {
        this.$message.error(e.message);
      } finally {
        this.saving = false;
      }
    },
    async toggleEnabled(row) {
      try {
        const res = await setAutoPublishEnabled(row.id, !row.enabled);
        this.applyList(res);
      } catch (e) {
        this.$message.error(e.message);
      }
    },
    async runNow(row) {
      try {
        await this.$confirm(
          row.allowRealPublish
            ? "将立即执行一次：调用 xAI 并尝试发布到头条微头条，继续？"
            : "将立即执行一次：仅调用 xAI 生成（不发帖），继续？",
          "确认",
          { type: "warning" }
        );
        this.loading = true;
        const res = await runAutoPublishNow(row.id);
        this.applyList(res);
        this.$message.success("已触发执行，请查看执行历史");
      } catch (e) {
        if (e !== "cancel") this.$message.error(e.message);
      } finally {
        this.loading = false;
      }
    },
    async removeTask(row) {
      try {
        await this.$confirm(`删除任务「${row.name}」？`, "确认", { type: "warning" });
        const res = await removeAutoPublishTask(row.id);
        this.applyList(res);
      } catch (e) {
        if (e !== "cancel") this.$message.error(e.message);
      }
    },
  },
};
</script>

<style scoped>
.page-desc {
  color: #606266;
  line-height: 1.6;
  max-width: 900px;
}
.section-block {
  margin-bottom: 16px;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.form-tip {
  margin-left: 8px;
  font-size: 12px;
  color: #909399;
}
.form-tip.danger {
  color: #f56c6c;
}
.danger-text {
  color: #f56c6c;
}
.ml-4 {
  margin-left: 4px;
}
</style>