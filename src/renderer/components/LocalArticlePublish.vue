<template>
  <div>
    <el-dialog
      :title="metaDialogTitle"
      :close-on-click-modal="false"
      :visible.sync="metaVisible"
      :close-on-press-escape="false"
      width="800px"
      @close="handleMetaClose"
    >
      <el-form label-width="96px" class="meta-form">
        <el-form-item :label="titleLabel">
          <div class="ai-field-row">
            <el-input v-model="form.title" :placeholder="titlePlaceholder" />
            <ai-generate-button
              :active="metaVisible"
              kind="title"
              :get-context="getAiContext"
              @generated="onAiTitle"
            />
          </div>
        </el-form-item>
        <el-form-item label="正文">
          <div class="ai-field-row">
            <el-input
              v-model="form.content"
              type="textarea"
              :rows="8"
              placeholder="请输入正文，或选择 .md/.txt 文章文件"
            />
            <ai-generate-button
              :active="metaVisible"
              kind="body"
              :get-context="getAiContext"
              @generated="onAiBody"
            />
          </div>
        </el-form-item>
        <el-form-item label="正文文件">
          <el-button size="mini" @click="selectArticleFile"
            >选择 .md/.txt 文件</el-button
          >
          <span v-if="articleFilePath" class="file-name">{{
            articleFileName
          }}</span>
        </el-form-item>
        <el-form-item v-if="mode !== 'weitoutiao'" label="封面图片">
          <el-button size="mini" @click="selectCoverImage"
            >选择封面图片</el-button
          >
          <span v-if="coverPath" class="file-name">{{ coverFileName }}</span>
        </el-form-item>
        <el-form-item v-if="mode === 'juejin'" label="分类">
          <el-input v-model="form.category" placeholder="默认 前端" />
        </el-form-item>
        <el-form-item label="标签">
          <div class="ai-field-row">
            <el-select
              v-model="tags"
              multiple
              filterable
              allow-create
              default-first-option
              no-data-text="请输入标签"
              placeholder="输入标签，回车添加为条目"
              style="width: 100%"
            ></el-select>
            <ai-generate-button
              :active="metaVisible"
              kind="tags"
              :get-context="getAiContext"
              @generated="onAiTags"
            />
          </div>
        </el-form-item>
        <el-form-item v-if="mode === 'juejin'" label="摘要">
          <el-input
            v-model="form.summary"
            type="textarea"
            :rows="3"
            placeholder="选填"
          />
        </el-form-item>
        <el-form-item v-if="mode !== 'juejin'" label="正文配图">
          <el-button size="mini" @click="selectImages">选择图片</el-button>
          <div v-if="imagePaths.length" class="selected-images">
            <el-tag
              v-for="(imagePath, index) in imagePaths"
              :key="imagePath + index"
              closable
              size="mini"
              @close="removeImage(index)"
            >{{ fileBaseName(imagePath) }}</el-tag>
          </div>
        </el-form-item>
        <el-form-item v-if="mode !== 'juejin'" label="发布方式">
          <el-switch
            v-model="draftMode"
            active-text="保存草稿"
            inactive-text="正式发布"
            :disabled="scheduledPublish"
          />
        </el-form-item>
        <el-form-item label="定时发布">
          <el-switch
            v-model="scheduledPublish"
            active-text="定时"
            inactive-text="立即"
            :disabled="draftMode"
          />
        </el-form-item>
        <el-form-item v-if="scheduledPublish" label="发布时间">
          <el-date-picker
            v-model="publishAt"
            type="datetime"
            value-format="yyyy-MM-dd HH:mm:ss"
            placeholder="选择年月日时分秒"
            style="width: 260px"
          />
          <p class="form-tip">
            定时任务会立即进入发布历史，到点后自动发布；如果程序关闭错过时间，会显示任务过期。
          </p>
        </el-form-item>
      </el-form>
      <div slot="footer" class="dialog-footer">
        <el-button @click="metaVisible = false">取消</el-button>
        <el-button type="primary" @click="onMetaNext">下一步</el-button>
      </div>
    </el-dialog>

    <el-dialog
      :title="platformDialogTitle"
      :close-on-click-modal="false"
      :visible.sync="platformVisible"
      :close-on-press-escape="false"
      width="800px"
      @close="handlePlatformClose"
    >
      <el-form class="article-form">
        <el-form-item label="是否显示自动化发布过程">
          <el-switch
            v-model="thisShow"
            active-text="显示"
            inactive-text="不显示"
          />
        </el-form-item>
        <el-form-item v-if="thisShow" label="发布完是否关闭窗口">
          <el-switch
            v-model="closeWindow"
            active-text="关闭"
            inactive-text="不关闭"
          />
        </el-form-item>
      </el-form>

      <el-divider content-position="left">{{ platformDialogTitle }}</el-divider>

      <el-tree
        v-if="treeData.length > 0"
        ref="tree"
        :data="treeData"
        node-key="id"
        show-checkbox
        default-expand-all
        :props="defaultProps"
      >
        <span class="custom-tree-node" slot-scope="{ data }">
          <template v-if="!data.url">
            <span>{{ data.title }}</span>
            <el-button
              size="mini"
              type="text"
              class="verify-button"
              @click.stop="verifyLogin(data)"
              >验证登录</el-button
            >
          </template>
          <template v-else>
            <span>{{ data.pt }}</span>
            <span
              class="login-state"
              :style="{ color: data.loggedIn ? 'green' : 'red' }"
            >
              <span v-if="data.loggedIn" class="login-ok" @click="reLogin(data)"
                >登录√</span
              >
              <span v-else @click="reLogin(data)">❌重新登录</span>
            </span>
          </template>
        </span>
      </el-tree>
      <el-empty
        v-if="treeData.length === 0"
        :description="'请先添加' + targetPlatform + '平台账号'"
      />

      <div slot="footer" class="dialog-footer">
        <el-button @click="platformVisible = false">取消</el-button>
        <el-button type="primary" @click="handleBatchPublish">
          {{ publishButtonText }}
        </el-button>
      </div>

      <!-- 旧的 <webview> 登录弹窗已迁移到主进程的独立 BrowserWindow，
           避免被 GuestView 指纹识别反复跳登录。点击"重新登录"会走 IPC 弹独立窗口。 -->
    </el-dialog>
  </div>
</template>

<script>
import { ipcRenderer } from "electron";
import moment from "moment";
import dataRequest from "@/utils/dataRequest";
import ptConfig from "@/utils/configUrl";
import openLoginWindow from "@/utils/openLoginWindow";
import { buildArticleRepublishState } from "@/utils/articleRepublish";
import AiGenerateButton from "@/components/ai/AiGenerateButton.vue";
import {
  accountLoginFlagNameOf,
  buildAccountPartitionOf,
  recordAccountKeyOf,
  recordAccountNameOf,
  recordGroupOf,
} from "../../shared/accountIdentity.js";
import {
  setAccountLoginFlag,
  clearAccountLoginFlag,
  isAccountLoginFlagSet,
} from "@/utils/accountLoginFlag";

function fileBaseName(p) {
  if (!p) return "";
  const s = String(p).replace(/\\/g, "/");
  const seg = s.split("/");
  return seg[seg.length - 1] || "";
}

function fileStem(p) {
  const b = fileBaseName(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
}

function formatTags(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .join(" ");
}

export default {
  components: { AiGenerateButton },
  name: "LocalArticlePublish",
  data() {
    return {
      ptConfig,
      mode: "juejin",
      metaVisible: false,
      platformVisible: false,
      articleFilePath: "",
      coverPath: "",
      imagePaths: [],
      draftMode: false,
      form: {
        title: "",
        content: "",
        category: "前端",
        summary: "",
      },
      tags: ["前端", "Electron"],
      thisShow: false,
      closeWindow: true,
      scheduledPublish: false,
      publishAt: "",
      showLoginDialog: false,
      loginData: {},
      treeData: [],
      taskHandlers: new Map(),
      republishContext: null,
      defaultProps: {
        children: "children",
        label: "title",
      },
    };
  },
  computed: {
    targetPlatform() {
      return this.mode === "juejin" ? "掘金" : "头条";
    },
    metaDialogTitle() {
      if (this.mode === "graphic") return "发布头条图文";
      if (this.mode === "weitoutiao") return "发布微头条";
      return "填写掘金文章内容";
    },
    platformDialogTitle() {
      return `选择${this.targetPlatform}账号并发布`;
    },
    titleLabel() {
      return this.mode === "weitoutiao" ? "标题（选填）" : "文章标题";
    },
    titlePlaceholder() {
      return this.mode === "weitoutiao"
        ? "可留空，默认使用正文首行"
        : this.mode === "graphic"
          ? "请输入 2～30 字标题"
          : "请输入文章标题";
    },
    publishButtonText() {
      if (this.draftMode) return "保存草稿";
      return this.scheduledPublish ? "创建定时任务" : "发布";
    },
    articleFileName() {
      return fileBaseName(this.articleFilePath);
    },
    coverFileName() {
      return fileBaseName(this.coverPath);
    },
  },
  mounted() {
    this._onGetCookieDone = (event, data) => {
      const { taskId } = data;
      const handler = this.taskHandlers.get(taskId);
      if (handler) {
        handler(data);
        this.taskHandlers.delete(taskId);
      }
    };
    ipcRenderer.on("getCookie-done", this._onGetCookieDone);
  },
  beforeDestroy() {
    if (this._onGetCookieDone) {
      ipcRenderer.removeListener("getCookie-done", this._onGetCookieDone);
    }
  },
  methods: {
    /** AI 生成素材：文章文件名 + 已填的标题 / 正文 / 摘要 / 标签 */
    getAiContext() {
      return {
        contentType: "article",
        name: this.articleFilePath ? this.articleFileName : "",
        title: this.form.title,
        body: this.form.content || this.form.summary,
        tags: this.tags,
      };
    },
    onAiTitle(value) {
      this.form.title = value;
    },
    onAiBody(value) {
      if (this.articleFilePath) {
        this.$message.info("AI 生成的内容已填入正文框，发布时将使用正文框内容，已选择的文章文件不会被使用");
      }
      this.form.content = value;
    },
    onAiTags(list) {
      const exist = new Set(this.tags.map(String));
      (list || []).forEach((t) => {
        if (!exist.has(t)) {
          this.tags.push(t);
          exist.add(t);
        }
      });
    },
    open(mode = "juejin") {
      this.resetState();
      this.mode = ["graphic", "weitoutiao"].includes(mode) ? mode : "juejin";
      if (this.mode !== "juejin") this.tags = [];
      this.metaVisible = true;
    },

    openRepublish(payload = {}) {
      const sample = payload.sample || {};
      const state = buildArticleRepublishState(sample);
      this.articleFilePath = state.articleFilePath;
      this.coverPath = state.coverPath;
      this.mode = ["graphic", "weitoutiao"].includes(sample.textType)
        ? sample.textType
        : "juejin";
      this.imagePaths = Array.isArray(sample.imagePaths)
        ? sample.imagePaths.slice()
        : [];
      this.draftMode =
        this.mode !== "juejin" &&
        (sample.publishToDraft === true || sample.publishMode === "draft");
      this.form = state.form;
      this.tags = state.tags;
      if (this.mode !== "juejin") {
        this.tags = String(sample.bq || sample.tags || "")
          .trim()
          .split(/\s+/)
          .filter(Boolean);
      }
      this.thisShow = false;
      this.closeWindow = true;
      this.scheduledPublish = false;
      this.publishAt = "";
      this.republishContext = {
        records: Array.isArray(payload.records) ? payload.records : [],
        failedTargets: Array.isArray(payload.failedTargets)
          ? payload.failedTargets
          : [],
      };
      this.metaVisible = false;
      this.loadAccounts();
      this.platformVisible = true;
      this.$nextTick(() => {
        const checkedKeys = this.resolveRepublishCheckedKeys(
          this.republishContext.failedTargets
        );
        if (this.$refs.tree) {
          this.$refs.tree.setCheckedKeys(checkedKeys);
        }
      });
      return true;
    },

    async selectArticleFile() {
      const path = await ipcRenderer.invoke("dialog:openArticleFile");
      if (!path) return;
      this.articleFilePath = path;
      if (!this.form.title || !this.form.title.trim()) {
        this.form.title = fileStem(path);
      }
    },

    async selectCoverImage() {
      const path = await ipcRenderer.invoke("dialog:openImageFile");
      if (path) {
        this.coverPath = path;
      }
    },

    async selectImages() {
      const selected = await ipcRenderer.invoke("dialog:openImageFiles");
      const paths = Array.isArray(selected) ? selected : [];
      const seen = new Set(this.imagePaths);
      paths.forEach((path) => {
        if (path && !seen.has(path)) {
          this.imagePaths.push(path);
          seen.add(path);
        }
      });
    },

    removeImage(index) {
      this.imagePaths.splice(index, 1);
    },

    fileBaseName,

    buildArticlePayload() {
      const content = String(this.form.content || "").trim();
      const fileName = fileBaseName(this.articleFilePath);
      const firstLine = content
        .split(/\r?\n/)
        .find((line) => String(line || "").trim());
      const title =
        this.form.title.trim() ||
        (this.mode === "weitoutiao"
          ? String(firstLine || fileStem(this.articleFilePath) || "微头条")
              .trim()
              .slice(0, 30)
          : "");
      const textType = this.mode === "juejin" ? "article" : this.mode;
      const isToutiao = this.mode !== "juejin";
      const isMicro = this.mode === "weitoutiao";
      return {
        bookName: title,
        textType,
        data: {
          title,
          content,
          articleFilePath: this.articleFilePath,
          coverPath: isMicro ? "" : this.coverPath,
          category: isToutiao ? "" : this.form.category.trim() || "前端",
          tags: formatTags(this.tags),
          summary: isToutiao ? "" : this.form.summary.trim(),
          imagePaths: isToutiao ? this.imagePaths.slice() : [],
        },
        textOtherName: title,
        selectedFile: fileName,
        imagePaths: isToutiao ? this.imagePaths.slice() : [],
      };
    },

    validateArticleMeta() {
      if (
        this.mode !== "weitoutiao" &&
        (!this.form.title || !this.form.title.trim())
      ) {
        return "请填写文章标题";
      }
      if (this.mode === "graphic") {
        const titleLength = this.form.title.trim().length;
        if (titleLength < 2 || titleLength > 30) {
          return "头条图文标题需 2～30 个字";
        }
      }
      if (
        (!this.form.content || !this.form.content.trim()) &&
        !this.articleFilePath
      ) {
        return "请填写正文或选择文章文件";
      }
      if (this.draftMode && this.scheduledPublish) {
        return "草稿模式不能同时设置定时发布";
      }
      return this.validatePublishAt();
    },

    validatePublishAt() {
      if (!this.scheduledPublish) return "";
      const value = String(this.publishAt || "").trim();
      if (!value) return "请选择定时发布时间";
      const dt = moment(value, "YYYY-MM-DD HH:mm:ss", true);
      if (!dt.isValid()) return "定时发布时间格式应为 YYYY-MM-DD HH:mm:ss";
      if (!dt.isAfter(moment())) return "定时发布时间必须是未来时间";
      return "";
    },

    onMetaNext() {
      const error = this.validateArticleMeta();
      if (error) {
        this.$message.warning(error);
        return;
      }
      this.loadAccounts();
      this.metaVisible = false;
      this.platformVisible = true;
      this.$nextTick(() => {
        if (this.$refs.tree) {
          this.$refs.tree.setCheckedKeys([]);
        }
      });
    },

    handleMetaClose() {
      if (!this.platformVisible) {
        this.resetState();
      }
    },

    handlePlatformClose() {
      if (!this.metaVisible) {
        this.resetState();
      }
    },

    resetState() {
      this.articleFilePath = "";
      this.coverPath = "";
      this.imagePaths = [];
      this.draftMode = false;
      this.mode = "juejin";
      this.form = {
        title: "",
        content: "",
        category: "前端",
        summary: "",
      };
      this.tags = ["前端", "Electron"];
      this.thisShow = false;
      this.closeWindow = true;
      this.scheduledPublish = false;
      this.publishAt = "";
      this.showLoginDialog = false;
      this.loginData = {};
      this.republishContext = null;
    },

    loadAccounts() {
      try {
        const raw = localStorage.getItem("accountTree");
        const parsed = raw ? JSON.parse(raw) : {};
        this.treeData = this.formatAccountTree(parsed);
      } catch (e) {
        this.treeData = [];
        console.error("账号树加载失败", e);
      }
    },

    formatAccountTree(rawTree) {
      return Object.keys(rawTree)
        .map((phone) => {
          const node = rawTree[phone] || {};
          const children = (node.children || [])
            .filter(
              (child) =>
                child &&
                child.meta &&
                String(child.meta.pt || "").trim() === this.targetPlatform
            )
            .map((child) => {
              // 新分组模型：保留完整 phone 并透传身份字段，登录态按 accountKey 判定
              const flagName = accountLoginFlagNameOf(child.meta, child.meta.pt);
              return {
                id: child.meta.id,
                pt: child.meta.pt,
                phone: child.meta.phone,
                group: recordGroupOf(child.meta),
                accountName: recordAccountNameOf(child.meta),
                accountKey: recordAccountKeyOf(child.meta),
                date: child.meta.date,
                url: child.meta.url,
                loggedIn: (() => {
                  if (isAccountLoginFlagSet(flagName)) return true;
                  const cookies = document.cookie.split(";");
                  for (const c of cookies) {
                    const [key, value] = c.trim().split("=");
                    if (key == flagName && value == "true") return true;
                  }
                  return false;
                })(),
              };
            });
          return {
            id: phone,
            title: phone,
            children,
          };
        })
        .filter((group) => group.children.length > 0);
    },

    verifyLogin(parent) {
      const children = parent.children || [];
      children.forEach((child) => {
        this.checkLoginStatus(child);
      });
    },

    checkLoginStatus(i) {
      const taskId = Date.now() + Math.random();
      const partition = buildAccountPartitionOf(i, i.pt);
      ipcRenderer.send("getCookie", {
        taskId,
        partition,
        url: i.url,
        pt: i.pt,
        name: accountLoginFlagNameOf(i, i.pt),
      });
      this.taskHandlers.set(taskId, (data) => {
        const flagName = data.flagName || accountLoginFlagNameOf(i, i.pt);
        if (data.success) {
          if (data.result) {
            setAccountLoginFlag(flagName, data.loginExpiresAtMs);
            try {
              document.cookie = data.result;
            } catch (e) {
              /* file:// 打包页面对 document.cookie 限制严格，已用 localStorage */
            }
          } else {
            clearAccountLoginFlag(flagName);
          }
        } else {
          clearAccountLoginFlag(flagName);
          console.error(
            `[${recordAccountKeyOf(i)}${i.pt}] 登录状态失败:`,
            data.error
          );
        }
      });
      setTimeout(() => {
        this.loadAccounts();
      }, 1000);
    },

    hideLoginDialog() {
      this.showLoginDialog = false;
      setTimeout(() => {
        this.loadAccounts();
      }, 1000);
    },

    async reLogin(item) {
      const partition = buildAccountPartitionOf(item, item.pt);
      try {
        const result = await openLoginWindow({ ...item, partition });
        if (result && result.ok === false) {
          this.$message.error(result.message || "打开登录窗口失败");
        } else if (result && result.reused) {
          this.$message.info("已切换到已打开的登录窗口");
        }
      } catch (e) {
        this.$message.error("打开登录窗口失败：" + (e && e.message ? e.message : e));
      }
      setTimeout(() => {
        if (typeof this.loadAccounts === "function") this.loadAccounts();
      }, 2000);
    },

    resolveRepublishCheckedKeys(failedTargets = []) {
      if (!Array.isArray(failedTargets) || failedTargets.length === 0)
        return [];
      // 新分组模型：优先按 partition 匹配（同分组同平台多账号时
      // phone 前缀不再唯一），老记录回退账号登录主键
      const targetSet = new Set(
        failedTargets.map((v) => this.republishTargetKey(v))
      );
      const keys = [];
      (this.treeData || []).forEach((group) => {
        (group.children || []).forEach((child) => {
          if (targetSet.has(this.republishTargetKey(child))) {
            keys.push(child.id);
          }
        });
      });
      return keys;
    },

    /** 重发匹配键：partition 优先，回退「登录主键 + 平台」 */
    republishTargetKey(target) {
      const pt = String((target && target.pt) || "").trim();
      if (target && target.partition) {
        return `p__${String(target.partition)}`;
      }
      return `k__${recordAccountKeyOf(target || {})}__${pt}`;
    },

    /** @param {object} node 账号树子节点（含 accountKey） */
    findRepublishRecord(pt, node) {
      if (
        !this.republishContext ||
        !Array.isArray(this.republishContext.records)
      )
        return null;
      const records = this.republishContext.records;
      const nodeKey = recordAccountKeyOf(node || {});
      return records.find(
        (item) =>
          String(item.pt || "") === String(pt || "") &&
          recordAccountKeyOf(item) === nodeKey
      );
    },

    buildPushRecord(article, p, partition, currentDate, extra = {}) {
      const ttGraphic = article.textType === "graphic";
      const weitoutiao = article.textType === "weitoutiao";
      const uploadUrl = weitoutiao
        ? this.ptConfig[p.pt].weitoutiaoUpload || this.ptConfig[p.pt].upload
        : ttGraphic
          ? this.ptConfig[p.pt].graphicUpload || this.ptConfig[p.pt].upload
          : this.ptConfig[p.pt].upload;
      return {
        bookName: article.bookName,
        textOtherName: article.textOtherName,
        textType: article.textType,
        pt: p.pt,
        selectedFile: article.selectedFile,
        bt: article.data.title,
        bq: article.data.tags,
        content: article.data.content,
        articleFilePath: article.data.articleFilePath,
        coverPath: article.data.coverPath,
        imagePaths: article.imagePaths,
        category: article.data.category,
        summary: article.data.summary,
        useragent: this.ptConfig[p.pt].useragent,
        phone: p.phone,
        group: p.group,
        accountName: p.accountName,
        accountKey: p.accountKey,
        partition,
        url: this.ptConfig[p.pt].listIndex,
        uploadUrl,
        date: currentDate,
        publishMode: this.draftMode ? "draft" : "publish",
        publishToDraft: this.draftMode,
        publishAttemptCount: 1,
        republishCount: 0,
        publishSuccessCount: 0,
        publishFailCount: 0,
        publishStatus: "publishing",
        lastPublishMessage: "等待发布结果",
        lastPublishAt: Date.now(),
        ...extra,
      };
    },

    async handleBatchPublish() {
      const error = this.validateArticleMeta();
      if (error) {
        this.$message.warning(error);
        return;
      }
      const checked = this.$refs.tree ? this.$refs.tree.getCheckedNodes(true) : [];
      const platforms = checked.filter(
        (item) => item.url && String(item.pt || "").trim() === this.targetPlatform
      );
      if (platforms.length === 0) {
        this.$message.warning(`请选择${this.targetPlatform}账号`);
        return;
      }

      const article = this.buildArticlePayload();
      const currentDate = moment().format("YYYY-MM-DD");
      const scheduledAtText = String(this.publishAt || "").trim();
      const scheduledAtMs = this.scheduledPublish
        ? moment(scheduledAtText, "YYYY-MM-DD HH:mm:ss", true).valueOf()
        : null;
      const scheduledWritePromises = [];

      for (let p of platforms) {
        const partition = buildAccountPartitionOf(p, p.pt);
        const taskId = Date.now() + Math.random();
        const shouldShow = this.thisShow;
        const shouldCloseWindowAfterPublish = shouldShow
          ? this.closeWindow
          : true;
        const ttGraphic = article.textType === "graphic";
        const weitoutiao = article.textType === "weitoutiao";
        const uploadUrl = weitoutiao
          ? this.ptConfig[p.pt].weitoutiaoUpload || this.ptConfig[p.pt].upload
          : ttGraphic
            ? this.ptConfig[p.pt].graphicUpload || this.ptConfig[p.pt].upload
            : this.ptConfig[p.pt].upload;

        if (this.scheduledPublish) {
          scheduledWritePromises.push(
            dataRequest({
              type: "add",
              fileName: "pushData",
              item: this.buildPushRecord(article, p, partition, currentDate, {
                scheduledTask: true,
                scheduledPublishAt: scheduledAtMs,
                scheduledPublishAtText: scheduledAtText,
                publishStatus: "scheduled",
                lastPublishMessage: "等待定时发布",
              }),
            })
          );
          continue;
        }

        // JSON 兜底序列化，避免 Vue 响应式代理 / 不可克隆对象触发 IPC 错误
        ipcRenderer.send("puppeteerFile", JSON.parse(JSON.stringify({
          ...p,
          taskId,
          ...article,
          publishMode: this.draftMode ? "draft" : "publish",
          publishToDraft: this.draftMode,
          url: uploadUrl,
          show: shouldShow,
          closeWindowAfterPublish: shouldCloseWindowAfterPublish,
          useragent: this.ptConfig[p.pt].useragent,
          partition,
          date: currentDate,
        })));

        const republishRecord = this.findRepublishRecord(p.pt, p);
        if (republishRecord && republishRecord.id && republishRecord.date) {
          const oldAttempt = Number(republishRecord.publishAttemptCount) || 1;
          let oldRepublish = Number(republishRecord.republishCount);
          if (!Number.isFinite(oldRepublish) || oldRepublish < 0) {
            oldRepublish = Math.max(0, oldAttempt - 1);
          }
          dataRequest({
            type: "update",
            fileName: "pushData",
            item: {
              id: republishRecord.id,
              date: republishRecord.date,
              bookName: article.bookName,
              textOtherName: article.textOtherName,
              selectedFile: article.selectedFile,
              bt: article.data.title,
              bq: article.data.tags,
              content: article.data.content,
              articleFilePath: article.data.articleFilePath,
              coverPath: article.data.coverPath,
              category: article.data.category,
              summary: article.data.summary,
              imagePaths: article.imagePaths,
              publishToDraft: this.draftMode,
              publishAttemptCount: oldAttempt + 1,
              republishCount: oldRepublish + 1,
              publishMode: this.draftMode ? "draft" : "publish",
              publishStatus: "publishing",
              // 重发开始即清掉上次失败截图，避免显示的是上一轮的旧画面
              failScreenshot: "",
              lastPublishMessage: "等待发布结果",
              lastPublishAt: Date.now(),
            },
          });
        } else {
          dataRequest({
            type: "add",
            fileName: "pushData",
            item: this.buildPushRecord(article, p, partition, currentDate),
          });
        }
      }

      if (this.scheduledPublish) {
        await Promise.all(scheduledWritePromises);
        ipcRenderer.send("scheduledPublish:refresh");
      }
      const successMessage = this.scheduledPublish
        ? `已创建 ${platforms.length} 个${this.targetPlatform}定时发布任务`
        : this.draftMode
          ? `已提交 ${platforms.length} 个${this.targetPlatform}账号保存草稿`
          : `已提交 ${platforms.length} 个${this.targetPlatform}账号发布`;
      this.$message.success(successMessage);
      this.platformVisible = false;
      this.resetState();
      this.$emit("published");
    },
  },
};
</script>

<style scoped>
.ai-field-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.ai-field-row > :first-child {
  flex: 1;
  min-width: 0;
}
.meta-form {
  margin-bottom: 8px;
}

.file-name {
  display: inline-block;
  margin-left: 10px;
  color: #606266;
  word-break: break-all;
}

.selected-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.form-tip {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #909399;
}

.article-form {
  margin-bottom: 16px;
}

.custom-tree-node {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
}

.verify-button,
.login-state {
  margin-left: 5px;
}

.login-ok {
  padding-left: 10px;
  cursor: pointer;
}
</style>
