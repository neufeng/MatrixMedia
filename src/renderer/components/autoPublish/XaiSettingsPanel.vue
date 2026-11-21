<template>
  <el-card shadow="never" class="xai-settings-card">
    <div slot="header" class="card-header">
      <span>xAI 设置</span>
      <span class="card-sub">Key 仅保存在本机，界面只显示掩码</span>
    </div>
    <el-alert
      v-if="!settings.secureStorage"
      type="warning"
      :closable="false"
      show-icon
      title="当前系统无法使用安全存储，xAI Key 将以受限方式保存；建议在 macOS/Windows 正式环境中配置。"
      class="mb-12"
    />
    <el-form label-width="120px" size="small">
      <el-form-item label="API 状态">
        <span v-if="settings.hasKey">已配置 {{ settings.maskedKey || "****" }}</span>
        <span v-else class="text-muted">未配置</span>
        <el-button v-if="settings.hasKey" type="text" @click="clearKey">清除 Key</el-button>
      </el-form-item>
      <el-form-item label="Base URL">
        <el-input v-model="form.baseURL" placeholder="https://api.x.ai/v1" />
      </el-form-item>
      <el-form-item label="文本模型">
        <el-input v-model="form.chatModel" placeholder="grok-4-fast" />
      </el-form-item>
      <el-form-item label="图片模型">
        <el-input v-model="form.imageModel" placeholder="grok-imagine-image-2.0" />
      </el-form-item>
      <el-form-item label="API Key">
        <el-input
          v-model="form.apiKey"
          type="password"
          show-password
          autocomplete="off"
          placeholder="留空表示沿用已保存 Key；示例：xai-****"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        <el-button :loading="testing" @click="testConn">测试连接</el-button>
      </el-form-item>
    </el-form>
    <p class="hint">
      仅向 xAI 官方 API（<code>https://api.x.ai</code>）发送授权请求；Key 不会写入仓库、发布记录或导出文件。
    </p>
  </el-card>
</template>

<script>
import {
  XAI_DEFAULT_BASE_URL,
  XAI_DEFAULT_CHAT_MODEL,
  XAI_DEFAULT_IMAGE_MODEL,
} from "../../../shared/xaiSettings.js";
import { getXaiSettings, saveXaiSettings, clearXaiKey, testXaiSettings } from "@/utils/autoPublish";

export default {
  name: "XaiSettingsPanel",
  data() {
    return {
      settings: {},
      form: {
        baseURL: XAI_DEFAULT_BASE_URL,
        chatModel: XAI_DEFAULT_CHAT_MODEL,
        imageModel: XAI_DEFAULT_IMAGE_MODEL,
        apiKey: "",
      },
      saving: false,
      testing: false,
    };
  },
  mounted() {
    this.refresh();
  },
  beforeDestroy() {
    this.form.apiKey = "";
  },
  methods: {
    async refresh() {
      const res = await getXaiSettings();
      this.settings = res.settings || res;
      const s = this.settings;
      this.form.baseURL = s.baseURL || XAI_DEFAULT_BASE_URL;
      this.form.chatModel = s.chatModel || XAI_DEFAULT_CHAT_MODEL;
      this.form.imageModel = s.imageModel || XAI_DEFAULT_IMAGE_MODEL;
    },
    async save() {
      this.saving = true;
      try {
        const res = await saveXaiSettings({ ...this.form });
        this.settings = res.settings;
        this.form.apiKey = "";
        this.$message.success("xAI 设置已保存");
      } catch (e) {
        this.$message.error(e.message);
      } finally {
        this.saving = false;
      }
    },
    async testConn() {
      this.testing = true;
      try {
        const payload = { ...this.form, useSaved: !this.form.apiKey };
        const res = await testXaiSettings(payload);
        this.$message.success(`连接成功，耗时 ${res.latencyMs} ms`);
      } catch (e) {
        this.$message.error("连接失败：" + e.message);
      } finally {
        this.testing = false;
      }
    },
    async clearKey() {
      try {
        await this.$confirm("确定清除已保存的 xAI API Key？", "确认", { type: "warning" });
        const res = await clearXaiKey();
        this.settings = res.settings;
        this.form.apiKey = "";
        this.$message.success("已清除");
      } catch (e) {
        if (e !== "cancel") this.$message.error(e.message);
      }
    },
  },
};
</script>

<style scoped>
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.card-sub {
  font-size: 12px;
  color: #909399;
}
.hint {
  font-size: 12px;
  color: #606266;
  line-height: 1.6;
}
.text-muted {
  color: #909399;
}
.mb-12 {
  margin-bottom: 12px;
}
</style>