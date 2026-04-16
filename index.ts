import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

const execFileAsync = promisify(execFile);
const HOME_DIR = process.env.HOME || '/home/yy';
const PLUGIN_DIR = path.join(HOME_DIR, '.openclaw', 'extensions', 'shanghainese-local-bridge');
const DEFAULT_PYTHON = path.join(HOME_DIR, '.openclaw', 'venvs', 'funasr', 'bin', 'python');
const DEFAULT_NANO_REPO_SCRIPT = path.join(PLUGIN_DIR, 'scripts', 'local_asr_funasr_nano_repo.py');
const DEFAULT_CLEAN_SCRIPT = path.join(PLUGIN_DIR, 'scripts', 'clean_transcript.py');
const DEFAULT_REWRITE_SCRIPT = path.join(PLUGIN_DIR, 'scripts', 'rewrite_shanghainese_order.py');
const DEFAULT_LLM_NORMALIZE_ENABLED = true;
const DEFAULT_LLM_TIMEOUT_MS = 20000;
const DEFAULT_DEBUG_VISIBLE_AGENTS = ['main'];
const FUNASR_BIN = path.join(HOME_DIR, '.openclaw', 'venvs', 'funasr', 'bin');
const ADAPTATION_DIR = path.join(PLUGIN_DIR, 'data');
const CONFIRMED_JSONL = path.join(ADAPTATION_DIR, 'confirmed-transcripts.jsonl');
const LEXICON_JSON = path.join(ADAPTATION_DIR, 'correction-lexicon.json');
const COMMON_MAPPINGS_JSON = path.join(ADAPTATION_DIR, 'common-mappings.json');
const PENDING_JSON = path.join(ADAPTATION_DIR, 'pending-confirmations.json');

function isAudioMediaPath(mediaPath: string): boolean {
  return /\.(ogg|opus|mp3|wav|m4a|aac|flac|mp4|webm)$/i.test(mediaPath);
}

async function transcribeLocally(
  mediaPath: string,
  pythonPath: string,
  nanoRepoScript: string,
): Promise<string | undefined> {
  if (!mediaPath || !isAudioMediaPath(mediaPath)) return undefined;
  try {
    const { stdout } = await execFileAsync(
      pythonPath,
      [nanoRepoScript, mediaPath],
      {
        env: { ...process.env, PATH: `${FUNASR_BIN}:${process.env.PATH || ''}` },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const lines = String(stdout || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.length ? lines[lines.length - 1] : undefined;
  } catch {
    return undefined;
  }
}

async function cleanTranscript(transcript: string, cleanScript: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cleanScript, [transcript]);
    return String(stdout || '').trim() || transcript;
  } catch {
    return transcript;
  }
}

async function rewriteTranscriptOrder(transcript: string, rewriteScript: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(rewriteScript, [transcript]);
    return String(stdout || '').trim() || transcript;
  } catch {
    return transcript;
  }
}

function buildMandarinNormalizePrompt(asrDraft: string, normalizedDraft: string): string {
  return [
    '你是上海话语音转普通话整理器。',
    '任务: 把输入整理成自然、简洁、忠实原意的普通话句子。',
    '硬性要求:',
    '1. 只输出最终普通话一句，不要解释。',
    '2. 不要补充原文没有的新事实。',
    '3. 优先保留时间、地点、人物、动作。',
    '4. 如果规则层结果已经自然，只做最小改动。',
    '5. 不要输出多个候选。',
    '',
    `ASR原稿: ${asrDraft}`,
    `规则整理后: ${normalizedDraft}`,
    '',
    '请只输出最终普通话结果:',
  ].join('\n');
}

function shouldUseLlmNormalization(transcript: string, corrected: string, cleaned: string, rewritten: string): boolean {
  const candidate = (rewritten || cleaned || corrected || transcript || '').trim();
  if (!candidate) return false;

  const dialectOrAwkwardSignals = [
    '啥么子', '哪能', '做啥', '有啥体', '阿拉', '侬', '伊拉', '伐', '辰光',
    '向夜饭', '夜里向夜饭', '早朗', '早浪', '早向', '今朝', '明朝', '后日', '落雨',
    '了说什么', '了讲什么', '了说啥', '了讲啥', '的时候吃过了吗', '你你',
  ];

  if (dialectOrAwkwardSignals.some((token) => candidate.includes(token))) return true;

  const correctedChanged = corrected.trim() !== transcript.trim();
  const rewrittenChanged = Boolean(rewritten.trim()) && rewritten.trim() !== cleaned.trim();

  if (correctedChanged || rewrittenChanged) {
    return false;
  }

  return true;
}

async function llmNormalizeTranscript(
  api: any,
  params: {
    transcript: string,
    normalizedDraft: string,
    channelId: string,
    from: string,
    timeoutMs: number,
    model?: string,
  },
): Promise<string> {
  const cfg = api.runtime.config.loadConfig();
  await api.runtime.agent.ensureAgentWorkspace(cfg);
  const agentDir = api.runtime.agent.resolveAgentDir(cfg);
  const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(cfg);
  const sessionId = `plugin:shanghainese-local-bridge:normalize:${params.channelId || 'unknown'}:${params.from || 'unknown'}`;
  const result = await api.runtime.agent.runEmbeddedAgent({
    sessionId,
    runId: crypto.randomUUID(),
    sessionFile: path.join(agentDir, 'sessions', 'plugin-shanghainese-local-bridge-normalize.jsonl'),
    workspaceDir,
    prompt: buildMandarinNormalizePrompt(params.transcript, params.normalizedDraft),
    timeoutMs: params.timeoutMs,
    disableTools: true,
    bootstrapContextMode: 'lightweight',
    trigger: 'manual',
    ...(params.model ? { model: params.model } : {}),
  });
  const text = String(
    result?.meta?.finalAssistantVisibleText
      || result?.payloads?.map((p: any) => p?.text || '').join('\n')
      || '',
  ).trim();
  return text || params.normalizedDraft;
}

type PendingRecord = {
  id: string,
  createdAt: string,
  channelId: string,
  from: string,
  audioPath: string,
  asrBackend: string,
  asrDraft: string,
  suggestedText: string,
  visible?: boolean,
};

function buildPendingKey(channelId: string, from: string): string {
  return `${channelId || 'unknown'}::${from || 'unknown'}`;
}

function resolveAgentIdFromSessionKey(sessionKey: string): string | undefined {
  const m = String(sessionKey || '').match(/^agent:([^:]+):/);
  return m?.[1] || undefined;
}

function shouldShowConfirmationDraft(event: any, debugVisibleAgents?: string[]): boolean {
  const visibleAgents = Array.isArray(debugVisibleAgents) && debugVisibleAgents.length
    ? debugVisibleAgents.map((v) => String(v || '').trim()).filter(Boolean)
    : DEFAULT_DEBUG_VISIBLE_AGENTS;
  const sessionKey = String(event?.sessionKey || '');
  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  if (!agentId) return true;
  return visibleAgents.includes(agentId);
}

async function ensureAdaptationDir(): Promise<void> {
  await mkdir(ADAPTATION_DIR, { recursive: true });
}

async function loadPendingMap(): Promise<Record<string, PendingRecord>> {
  try {
    const raw = await readFile(PENDING_JSON, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

async function savePendingMap(data: Record<string, PendingRecord>): Promise<void> {
  await ensureAdaptationDir();
  await writeFile(PENDING_JSON, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function extractSingleReplacement(source: string, target: string): { from: string, to: string } | undefined {
  if (!source || !target || source === target) return undefined;
  let left = 0;
  while (left < source.length && left < target.length && source[left] === target[left]) left += 1;
  let right = 0;
  while (
    right < source.length - left
    && right < target.length - left
    && source[source.length - 1 - right] === target[target.length - 1 - right]
  ) right += 1;
  const from = source.slice(left, source.length - right || source.length);
  const to = target.slice(left, target.length - right || target.length);
  if (!from || !to || from === to) return undefined;
  return { from, to };
}

async function appendConfirmedRecord(record: Record<string, unknown>): Promise<void> {
  await ensureAdaptationDir();
  await appendFile(CONFIRMED_JSONL, `${JSON.stringify(record, ensureJsonReplacer())}\n`, 'utf8');
}

function ensureJsonReplacer() {
  return (_key: string, value: unknown) => value;
}

async function updateCorrectionLexicon(asrDraft: string, confirmedText: string): Promise<void> {
  const replacement = extractSingleReplacement(asrDraft, confirmedText);
  if (!replacement) return;
  await ensureAdaptationDir();
  let lexicon: Record<string, { target: string, count: number, examples: string[] }> = {};
  try {
    lexicon = JSON.parse(await readFile(LEXICON_JSON, 'utf8'));
  } catch {
    lexicon = {};
  }
  const current = lexicon[replacement.from];
  if (current && current.target === replacement.to) {
    current.count += 1;
    if (!current.examples.includes(asrDraft)) current.examples.push(asrDraft);
  } else {
    lexicon[replacement.from] = {
      target: replacement.to,
      count: current?.target === replacement.to ? current.count + 1 : 1,
      examples: [asrDraft],
    };
  }
  await writeFile(LEXICON_JSON, `${JSON.stringify(lexicon, null, 2)}\n`, 'utf8');
}

async function loadJsonSafe(filePath: string): Promise<Record<string, any>> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function applyFlatMappings(text: string, mappings: Record<string, string>): string {
  const entries = Object.entries(mappings)
    .filter(([from, to]) => Boolean(from && to))
    .sort((a, b) => b[0].length - a[0].length);
  let output = text;
  for (const [from, to] of entries) {
    if (!output.includes(from)) continue;
    output = output.split(from).join(to);
  }
  return output;
}

async function applyCorrectionLexicon(text: string): Promise<string> {
  if (!text) return text;
  const commonMappings = await loadJsonSafe(COMMON_MAPPINGS_JSON);
  const commonFlat = {
    ...(commonMappings.time || {}),
    ...(commonMappings.location || {}),
    ...(commonMappings.phrase || {}),
  };
  const personalLexicon = await loadJsonSafe(LEXICON_JSON);
  const personalFlat = Object.fromEntries(
    Object.entries(personalLexicon)
      .filter(([from, meta]) => Boolean(from && meta && typeof meta === 'object' && (meta as any).target))
      .map(([from, meta]) => [from, (meta as any).target]),
  );

  const afterCommon = applyFlatMappings(text, commonFlat);
  return applyFlatMappings(afterCommon, personalFlat);
}

export default definePluginEntry({
  id: 'shanghainese-local-bridge',
  name: 'Shanghainese Local Bridge',
  description: 'Use local Fun-ASR-Nano plus mapping, rule-based rewrite, and optional embedded-agent Mandarin normalization for Shanghainese voice notes.',
  register(api) {
    api.registerHook('message:transcribed', async (event: any) => {
      try {
        if (event?.type !== 'message' || event?.action !== 'transcribed') return;

        const pluginCfg = api.config?.plugins?.entries?.['shanghainese-local-bridge']?.config || {};
        if (pluginCfg?.enabled === false) return;

        const mediaPath = String(event?.context?.mediaPath || '').trim();
        const upstreamTranscript = String(event?.context?.transcript || '').trim();
        const pythonPath = String(pluginCfg?.pythonPath || DEFAULT_PYTHON);
        const nanoRepoScript = String(pluginCfg?.nanoRepoScript || DEFAULT_NANO_REPO_SCRIPT);
        const cleanScript = String(pluginCfg?.cleanScript || DEFAULT_CLEAN_SCRIPT);
        const rewriteScript = String(pluginCfg?.rewriteScript || DEFAULT_REWRITE_SCRIPT);
        const llmNormalizeEnabled = pluginCfg?.llmNormalizeEnabled ?? DEFAULT_LLM_NORMALIZE_ENABLED;
        const llmNormalizeModel = String(pluginCfg?.llmNormalizeModel || '').trim();
        const llmNormalizeTimeoutMs = Number(pluginCfg?.llmNormalizeTimeoutMs || DEFAULT_LLM_TIMEOUT_MS);
        const debugVisibleAgents = Array.isArray(pluginCfg?.debugVisibleAgents)
          ? pluginCfg.debugVisibleAgents
          : DEFAULT_DEBUG_VISIBLE_AGENTS;

        const localTranscript = await transcribeLocally(
          mediaPath,
          pythonPath,
          nanoRepoScript,
        );
        const transcript = localTranscript || upstreamTranscript;
        if (!transcript) return;

        const channelId = String(event?.context?.channelId || '');
        const from = String(event?.context?.from || '');
        const correctedTranscript = await applyCorrectionLexicon(transcript);
        const cleaned = await cleanTranscript(correctedTranscript, cleanScript);
        const rewritten = await rewriteTranscriptOrder(cleaned, rewriteScript);
        const baseSuggested = rewritten || cleaned || correctedTranscript || transcript;
        const llmNormalized = llmNormalizeEnabled
          && shouldUseLlmNormalization(transcript, correctedTranscript, cleaned, rewritten)
          ? await llmNormalizeTranscript(api, {
            transcript,
            normalizedDraft: baseSuggested,
            channelId,
            from,
            timeoutMs: llmNormalizeTimeoutMs,
            ...(llmNormalizeModel ? { model: llmNormalizeModel } : {}),
          })
          : '';
        const suggestedText = llmNormalized || baseSuggested;
        const visible = shouldShowConfirmationDraft(event, debugVisibleAgents);
        if (event?.context) {
          event.context.transcript = suggestedText;
        }
        const pending = await loadPendingMap();
        pending[buildPendingKey(channelId, from)] = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          channelId,
          from,
          audioPath: mediaPath,
          asrBackend: 'fun-asr-nano-repo',
          asrDraft: transcript,
          suggestedText,
          visible,
        };
        await savePendingMap(pending);

        if (!visible) return;

        event.messages.push([
          '【沪语语音确认稿｜本地fun-asr-nano-repo+mapping】',
          `ASR原稿：${transcript}`,
          correctedTranscript !== transcript ? `词典纠偏：${correctedTranscript}` : '',
          rewritten && rewritten !== cleaned ? `语序整理：${rewritten}` : '',
          llmNormalized && llmNormalized !== (rewritten || cleaned || correctedTranscript || transcript) ? `LLM普通话化：${llmNormalized}` : '',
          `建议整理：${suggestedText}`,
          '',
          '请直接回复：',
          '1) 发送“确认”，表示采用建议整理',
          '2) 或直接发你认为正确的文字',
        ].join('\n'));
        return;
      } catch (err: any) {
        event.messages.push(`【shanghainese-local-bridge 插件失败】${err?.message || String(err)}`);
      }
    }, {
      name: 'shanghainese-local-bridge.message-transcribed',
      description: 'Prefer local FunASR Paraformer and normalize the transcript through an embedded agent turn.',
    });

    api.registerHook('message:received', async (event: any) => {
      try {
        if (event?.type !== 'message' || event?.action !== 'received') return;
        const content = String(event?.context?.content || '').trim();
        if (!content || content.startsWith('/')) return;

        const channelId = String(event?.context?.channelId || '');
        const from = String(event?.context?.from || '');
        const pendingKey = buildPendingKey(channelId, from);
        const pending = await loadPendingMap();
        const current = pending[pendingKey];
        if (!current) return;

        const ageMs = Date.now() - new Date(current.createdAt).getTime();
        if (!Number.isFinite(ageMs) || ageMs > 2 * 60 * 60 * 1000) {
          delete pending[pendingKey];
          await savePendingMap(pending);
          return;
        }

        const confirmedText = content === '确认' ? current.suggestedText : content;
        await appendConfirmedRecord({
          id: current.id,
          createdAt: new Date().toISOString(),
          channel: 'telegram',
          chatId: channelId,
          audioPath: current.audioPath,
          asrBackend: current.asrBackend,
          asrDraft: current.asrDraft,
          suggestedText: current.suggestedText,
          confirmedText,
          language: 'zh',
          dialect: 'shanghainese-wu',
          tags: ['manual-confirmation'],
        });
        await updateCorrectionLexicon(current.asrDraft, confirmedText);

        delete pending[pendingKey];
        await savePendingMap(pending);
        if (current.visible !== false) {
          event.messages.push(`【已记录纠偏确认】${confirmedText}`);
        }
      } catch (err: any) {
        event.messages.push(`【shanghainese-local-bridge 确认入库失败】${err?.message || String(err)}`);
      }
    }, {
      name: 'shanghainese-local-bridge.message-received-confirmation',
      description: 'Capture confirmation replies and append them to Shanghainese adaptation data.',
    });
  },
});
