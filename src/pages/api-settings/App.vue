<template>
  <div class="api-settings">
    <header class="header">
      <h1>API 设置</h1>
      <p class="subtitle">管理 AI 后端提供商和 API 密钥</p>
    </header>

    <div class="toolbar">
      <button class="btn-add" @click="createNew">+ 添加提供商</button>
      <span class="hint">支持 OpenAI、APIMart、Gemini、火山引擎、RunningHub 协议</span>
    </div>

    <div v-if="loading" class="status">加载中...</div>
    <div v-else-if="error" class="status error">{{ error }}</div>

    <div class="provider-list">
      <div
        v-for="p in providers"
        :key="p.id"
        class="provider-card"
        :class="{ selected: editingId === p.id, disabled: !p.enabled }"
        @click="selectProvider(p.id)"
      >
        <div class="card-header">
          <span class="name">{{ p.name }}</span>
          <span class="protocol-tag">{{ p.protocol }}</span>
          <span class="status-dot" :class="p.enabled ? 'on' : 'off'"></span>
        </div>
        <div class="card-body">
          <div class="field"><label>ID</label><span>{{ p.id }}</span></div>
          <div class="field"><label>地址</label><span class="url">{{ p.base_url }}</span></div>
          <div class="field"><label>模型</label><span>{{ (p.image_models || []).length }} 图片 / {{ (p.chat_models || []).length }} 对话 / {{ (p.video_models || []).length }} 视频</span></div>
        </div>
      </div>
    </div>

    <div v-if="editingProvider" class="editor-overlay" @click.self="closeEditor">
      <div class="editor">
        <div class="editor-header">
          <h2>{{ editingProvider.id ? '编辑' : '新建' }} 提供商</h2>
          <button class="btn-close" @click="closeEditor">&times;</button>
        </div>

        <form @submit.prevent="saveProvider" class="editor-form">
          <div class="form-group">
            <label>名称</label>
            <input v-model="editingProvider.name" placeholder="例如：我的 OpenAI" required />
          </div>
          <div class="form-group">
            <label>ID</label>
            <input v-model="editingProvider.id" placeholder="my-openai" :disabled="!!originalId" required />
          </div>
          <div class="form-group">
            <label>协议</label>
            <select v-model="editingProvider.protocol">
              <option value="openai">OpenAI 兼容</option>
              <option value="apimart">APIMart</option>
              <option value="gemini">Gemini</option>
              <option value="volcengine">火山引擎</option>
              <option value="runninghub">RunningHub</option>
            </select>
          </div>
          <div class="form-group">
            <label>基础 URL</label>
            <input v-model="editingProvider.base_url" placeholder="https://api.example.com" />
          </div>
          <div class="form-group">
            <label>图片生成端点</label>
            <input v-model="editingProvider.image_generation_endpoint" placeholder="/v1/images/generations" />
          </div>
          <div class="form-group">
            <label>API 密钥</label>
            <input v-model="apiKeyInput" type="password" placeholder="留空则不修改" />
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="editingProvider.enabled" />
              启用此提供商
            </label>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="editingProvider.primary" />
              设为默认
            </label>
          </div>

          <div class="form-group">
            <label>图片模型（逗号分隔）</label>
            <textarea v-model="imageModelsText" rows="3" placeholder="gpt-image-2, dall-e-3"></textarea>
          </div>

          <div class="form-group">
            <label>对话模型（逗号分隔）</label>
            <textarea v-model="chatModelsText" rows="3" placeholder="gpt-4o, gpt-4o-mini"></textarea>
          </div>

          <div class="form-group">
            <label>视频模型（逗号分隔）</label>
            <textarea v-model="videoModelsText" rows="2" placeholder="veo3-fast, seedance2-0"></textarea>
          </div>

          <div class="editor-actions">
            <button type="submit" class="btn-save" :disabled="saving">
              {{ saving ? '保存中...' : '保存' }}
            </button>
            <button type="button" class="btn-test" @click="testConnection" :disabled="testing">
              {{ testing ? '测试中...' : '测试连接' }}
            </button>
            <button
              v-if="originalId"
              type="button"
              class="btn-delete"
              @click="deleteProvider"
            >
              删除
            </button>
          </div>

          <div v-if="statusMsg" class="status-msg" :class="{ error: statusError }">
            {{ statusMsg }}
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { get, post, del } from '@shared/api-client'
import type { ApiProviderPayload } from '@shared/types/api'

const providers = ref<ApiProviderPayload[]>([])
const editingId = ref('')
const editingProvider = ref<Partial<ApiProviderPayload> | null>(null)
const originalId = ref('')
const apiKeyInput = ref('')
const loading = ref(true)
const error = ref('')
const saving = ref(false)
const testing = ref(false)
const statusMsg = ref('')
const statusError = ref(false)

const imageModelsText = ref('')
const chatModelsText = ref('')
const videoModelsText = ref('')

const selected = computed(() =>
  providers.value.find((p) => p.id === editingId.value)
)

async function loadProviders() {
  loading.value = true
  error.value = ''
  try {
    const data = await get<any[]>('/api/providers')
    providers.value = data || []
  } catch (e: any) {
    error.value = '加载失败: ' + e.message
  } finally {
    loading.value = false
  }
}

function selectProvider(id: string) {
  editingId.value = id
}

function createNew() {
  editingProvider.value = {
    id: '',
    name: '',
    base_url: '',
    protocol: 'openai',
    image_generation_endpoint: '',
    image_edit_endpoint: '',
    enabled: true,
    primary: false,
    image_models: [],
    chat_models: [],
    video_models: [],
    ms_loras: [],
    ms_defaults_version: 0,
    rh_apps: [],
    rh_workflows: [],
  }
  originalId.value = ''
  apiKeyInput.value = ''
  imageModelsText.value = ''
  chatModelsText.value = ''
  videoModelsText.value = ''
  statusMsg.value = ''
}

function openEditor() {
  if (!editingProvider.value) return
  const p = selected.value
  if (p) {
    editingProvider.value = { ...p }
    originalId.value = p.id
    imageModelsText.value = (p.image_models || []).join(', ')
    chatModelsText.value = (p.chat_models || []).join(', ')
    videoModelsText.value = (p.video_models || []).join(', ')
  }
  apiKeyInput.value = ''
}

watch(editingId, (newId) => {
  if (newId && selected.value) {
    openEditor()
  }
})

async function saveProvider() {
  const form = editingProvider.value
  if (!form || !form.name || !form.id) return

  saving.value = true
  statusMsg.value = ''
  try {
    const payload: any = {
      ...form,
      image_models: imageModelsText.value.split(',').map((s) => s.trim()).filter(Boolean),
      chat_models: chatModelsText.value.split(',').map((s) => s.trim()).filter(Boolean),
      video_models: videoModelsText.value.split(',').map((s) => s.trim()).filter(Boolean),
    }
    if (apiKeyInput.value) {
      payload.api_key = apiKeyInput.value
    }

    await post('/api/providers', payload)
    statusMsg.value = '保存成功'
    statusError.value = false
    await loadProviders()
    editingProvider.value = null
  } catch (e: any) {
    statusMsg.value = '保存失败: ' + e.message
    statusError.value = true
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  const form = editingProvider.value
  if (!form || !form.id) return

  testing.value = true
  statusMsg.value = ''
  try {
    await post('/api/providers/test', {
      id: form.id,
      base_url: form.base_url,
      protocol: form.protocol,
      image_generation_endpoint: form.image_generation_endpoint,
      api_key: apiKeyInput.value || undefined,
    })
    statusMsg.value = '连接成功'
    statusError.value = false
  } catch (e: any) {
    statusMsg.value = '连接失败: ' + e.message
    statusError.value = true
  } finally {
    testing.value = false
  }
}

async function deleteProvider() {
  if (!originalId.value) return
  if (!confirm(`确定要删除 "${editingProvider.value?.name}" 吗？`)) return

  try {
    await del('/api/providers/' + originalId.value)
    await loadProviders()
    editingProvider.value = null
  } catch (e: any) {
    statusMsg.value = '删除失败: ' + e.message
    statusError.value = true
  }
}

function closeEditor() {
  editingProvider.value = null
}

onMounted(loadProviders)
</script>

<style scoped>
.api-settings {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
  min-height: 100vh;
  background: #0f0f1a;
  color: #e0e0e0;
}

.header h1 {
  font-size: 24px;
  margin: 0 0 4px;
}
.subtitle {
  font-size: 14px;
  color: #888;
  margin: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 20px 0;
}
.btn-add {
  padding: 8px 20px;
  background: #4a6cf7;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.btn-add:hover {
  background: #3b5de7;
}
.hint {
  font-size: 13px;
  color: #666;
}

.status {
  padding: 12px;
  border-radius: 6px;
  background: #1a1a2e;
}
.status.error {
  color: #f87171;
  background: #2d1b1b;
}

.provider-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.provider-card {
  background: #1a1a2e;
  border: 1px solid #2a2a4a;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.provider-card:hover {
  border-color: #4a6cf7;
}
.provider-card.selected {
  border-color: #4a6cf7;
  background: #1e1e36;
}
.provider-card.disabled {
  opacity: 0.5;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.card-header .name {
  font-weight: 600;
  font-size: 16px;
}
.protocol-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: #2a2a4a;
  color: #aaa;
  text-transform: uppercase;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: auto;
}
.status-dot.on {
  background: #4ade80;
}
.status-dot.off {
  background: #666;
}

.card-body .field {
  display: flex;
  gap: 12px;
  font-size: 13px;
  margin-bottom: 4px;
}
.card-body label {
  color: #888;
  min-width: 40px;
}
.card-body .url {
  color: #6b8cff;
  word-break: break-all;
}

.editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.editor {
  background: #1a1a2e;
  border: 1px solid #2a2a4a;
  border-radius: 12px;
  width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 24px;
}
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.editor-header h2 {
  margin: 0;
  font-size: 20px;
}
.btn-close {
  background: none;
  border: none;
  color: #aaa;
  font-size: 24px;
  cursor: pointer;
}

.form-group {
  margin-bottom: 14px;
}
.form-group label {
  display: block;
  font-size: 13px;
  color: #aaa;
  margin-bottom: 4px;
}
.form-group input[type="text"],
.form-group input[type="password"],
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 8px 12px;
  background: #0f0f1a;
  border: 1px solid #2a2a4a;
  border-radius: 6px;
  color: #e0e0e0;
  font-size: 14px;
}
.form-group input:disabled {
  opacity: 0.5;
}
.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.editor-actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}
.btn-save, .btn-test, .btn-delete {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.btn-save {
  background: #4a6cf7;
  color: #fff;
}
.btn-test {
  background: #2a2a4a;
  color: #ccc;
}
.btn-delete {
  background: #7f1d1d;
  color: #fca5a5;
  margin-left: auto;
}
.btn-save:hover { background: #3b5de7; }
.btn-test:hover { background: #3a3a5a; }
.btn-delete:hover { background: #991b1b; }
.btn-save:disabled, .btn-test:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status-msg {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  background: #1a3a1a;
  color: #4ade80;
  font-size: 13px;
}
.status-msg.error {
  background: #3a1a1a;
  color: #f87171;
}
</style>
