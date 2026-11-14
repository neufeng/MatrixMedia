<template>
  <span class="ai-generate">
    <el-tooltip :content="tooltip" placement="top" :open-delay="400">
      <el-button
        class="ai-generate-btn"
        size="mini"
        type="primary"
        plain
        :icon="loading ? '' : 'el-icon-magic-stick'"
        :loading="loading"
        :disabled="disabled"
        @click="run"
      >
        {{ loading ? "生成中…" : label }}
      </el-button>
    </el-tooltip>
    <el-button v-if="loading" class="ai-generate-btn" size="mini" @click="cancel">取消</el-button>
    <el-dropdown
      v-else-if="providers.length > 1"
      trigger="click"
      size="mini"
      class="ai-provider-dropdown"
      @command="selectProvider"
      @visible-change="onDropdownVisible"
    >
      <el-button class="ai-generate-btn" size="mini" :disabled="disabled" :title="`当前：${currentProviderLabel}`">
        <i class="el-icon-arrow-down"></i>
      </el-button>
      <el-dropdown-menu slot="dropdown">
        <el-dropdown-item
          v-for="p in providers"
          :key="p.id"
          :command="p.id"
          :class="{ 'is-current': p.id === currentProviderId }"
        >
          <i :class="p.id === currentProviderId ? 'el-icon-check' : 'ai-provider-blank'"></i>
          {{ p.name }}（{{ p.model }}）{{ p.isDefault ? " · 默认" : "" }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </el-dropdown>
  </span>
</template>

<script>
import { cancelAiGenerate, generateAiContent, listAiProviders } from "@/utils/aiContent";

const KIND_LABEL = { title: "标题", body: "正文", tags: "标签" };
/** 发布页选择的 AI 配置，所有「AI 生成」按钮共用；为空或配置已删除时用默认配置 */
const AI_PROVIDER_STORAGE_KEY = "matrixmedia.ai.selectedProviderId";

let requestSeq = 0;

function readSelectedProviderId() {
  try {
    return window.localStorage.getItem(AI_PROVIDER_STORAGE_KEY) || "";
  } catch (_) {
    return "";
  }
}

function writeSelectedProviderId(id) {
  try {
    if (id) window.localStorage.setItem(AI_PROVIDER_STORAGE_KEY, id);
    else window.localStorage.removeItem(AI_PROVIDER_STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
}

/**
 * 「AI 生成」按钮：点击后用 getContext() 取当前表单素材，生成成功后 emit("generated", value)。
 * value：title/body 为字符串，tags 为字符串数组。错误统一用 $message 提示。
 * - 配置了多个 AI 接口时，按钮旁出现下拉，可选择本次用哪个配置（记住选择，所有按钮共用）。
 * - 生成中可点「取消」；传入的 active 变为 false（如所在弹窗关闭）或组件销毁时自动中止请求。
 */
export default {
  name: "AiGenerateButton",
  props: {
    kind: { type: String, required: true },
    getContext: { type: Function, required: true },
    label: { type: String, default: "AI 生成" },
    disabled: { type: Boolean, default: false },
    /** 所在弹窗是否可见；变为 false 时中止进行中的生成 */
    active: { type: Boolean, default: true },
  },
  data() {
    return { loading: false, requestId: "", providers: [], selectedProviderId: readSelectedProviderId() };
  },
  computed: {
    tooltip() {
      return `根据已填写的名称/标题/简介，用 AI 生成${KIND_LABEL[this.kind] || ""}（在「项目详情 → AI 设置」配置 API Key）`;
    },
    currentProviderId() {
      if (this.providers.some((p) => p.id === this.selectedProviderId)) return this.selectedProviderId;
      const def = this.providers.find((p) => p.isDefault) || this.providers[0];
      return def ? def.id : "";
    },
    currentProviderLabel() {
      const p = this.providers.find((x) => x.id === this.currentProviderId);
      return p ? `${p.name}（${p.model}）` : "默认配置";
    },
  },
  watch: {
    active(v) {
      if (v) this.loadProviders();
      else this.cancel({ silent: true });
    },
  },
  mounted() {
    this.loadProviders();
  },
  beforeDestroy() {
    this.cancel({ silent: true });
  },
  methods: {
    async loadProviders() {
      try {
        const res = await listAiProviders();
        this.providers = res.providers || [];
      } catch (_) {
        this.providers = [];
      }
    },
    onDropdownVisible(visible) {
      if (visible) this.loadProviders();
    },
    selectProvider(id) {
      this.selectedProviderId = id;
      writeSelectedProviderId(id);
    },
    async cancel({ silent = false } = {}) {
      if (!this.loading || !this.requestId) return;
      const id = this.requestId;
      this.requestId = "";
      try {
        await cancelAiGenerate(id);
      } catch (_) {
        /* ignore */
      }
      if (!silent) this.$message.info("已取消 AI 生成");
    },
    async run() {
      if (this.loading) return;
      const requestId = `${this.kind}-${Date.now()}-${++requestSeq}`;
      this.requestId = requestId;
      this.loading = true;
      this.$emit("loading", true);
      try {
        const res = await generateAiContent(this.kind, this.getContext() || {}, {
          providerId: this.selectedProviderId || undefined,
          requestId,
        });
        // 已取消（或弹窗已关闭）则丢弃结果，不改动表单
        if (this.requestId !== requestId) return;
        this.$emit("generated", res.value);
        this.$message.success(`已用 ${res.providerName}（${res.model}）生成${KIND_LABEL[this.kind] || ""}`);
      } catch (e) {
        if (e.canceled || this.requestId !== requestId) return;
        const msg = e.message || "生成失败";
        if (/还没有配置 AI 接口/.test(msg)) {
          // 确认按钮引导去配置；点关闭/取消则留在原地（不丢正在填写的发布内容）
          this.$alert(msg, "未配置 AI", {
            type: "info",
            confirmButtonText: "去配置",
          })
            .then(() => {
              this.$router.push("/project-detail?tab=ai").catch(() => {});
            })
            .catch(() => {});
        } else if (/未找到|不存在/.test(msg) && this.selectedProviderId) {
          // 记住的配置已被删除：清掉选择，下次用默认配置
          this.selectProvider("");
          this.loadProviders();
          this.$message.error("AI 生成失败：" + msg + "，已切回默认配置");
        } else {
          this.$message.error("AI 生成失败：" + msg);
        }
      } finally {
        if (this.requestId === requestId || !this.requestId) {
          this.requestId = "";
          this.loading = false;
          this.$emit("loading", false);
        }
      }
    },
  },
};
</script>

<style lang="scss" scoped>
.ai-generate {
  display: inline-flex;
  align-items: flex-start;
  gap: 4px;
}
.ai-generate-btn {
  padding: 5px 10px;
}
.ai-generate .el-button + .el-button {
  margin-left: 0;
}
</style>
<style lang="scss">
.ai-provider-blank {
  display: inline-block;
  width: 14px;
}
</style>
