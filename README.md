# OpenClaw 上海话语音输入插件 Shanghainese Local Bridge

OpenClaw Telegram 上海话语音输入插件。

本插件用于将上海话 / 沪语短语音接入 OpenClaw，对语音内容进行本地转写，并输出更适合 agent 使用的普通话文本。

当前插件包含以下修正链路：
- **自动纠偏**：对高频时间词、地名、口语表达进行基础修正
- **个人词典**：将确认后的个人高频表达持续写入词典回灌
- **规则映射**：使用映射表和规则型语序整理处理稳定模式
- **LLM 修正**：在规则层仍不足时，按需做普通话化整理

## Installation

将本插件目录放到：

```text
~/.openclaw/extensions/shanghainese-local-bridge/
```

然后确认：
- OpenClaw 已安装
- `plugins.allow` 中包含 `shanghainese-local-bridge`
- Python venv 可用
- `vendor/Fun-ASR` 已随插件一并存在

最小安装检查：

```bash
openclaw gateway status
~/.openclaw/venvs/funasr/bin/python --version
```

---

## 1. 功能概览

```text
用户发送沪语语音
-> message:transcribed
-> Fun-ASR-Nano-2512 常驻 worker
-> 基础映射纠偏
-> 个人词典回灌
-> 轻清洗
-> 规则型语序整理
-> 必要时 LLM 普通话化
-> 输出确认稿或静默写回 transcript
-> 用户确认后自动写入数据文件
```

---

## 2. 主要特点

### 2.1 本地优先
- 使用本地 `Fun-ASR-Nano-2512`
- 不依赖云端 ASR 服务
- 避免每条请求上传外部平台

### 2.2 常驻模型加速
- 使用本地常驻 worker 持有 Nano 模型
- 避免每次重新加载 5GB+ 模型
- 当前热态 3 秒左右语音可做到约 **1.5 ~ 2.5 秒**

### 2.3 映射表优先纠偏
- 不把纠偏完全交给 LLM 猜
- 先走机器可控映射表
- 结果更稳定，执行更快，可解释性更强

### 2.4 个人化持续学习
- 用户每次确认结果都会自动入库
- 自动累积：
  - 语音样本确认集
  - 错词 -> 正词映射
  - 后续微调数据资产

### 2.5 适合短语音场景
特别适合：
- Telegram 语音
- 短时沪语表达
- 时间、地点、日常口语
- 需要边用边积累纠偏能力的场景

---

## Architecture

设计原则：
- 规则优先，LLM 兜底
- 能用代码解决的，优先不用 LLM
- 调试模式与线上静默模式分离
- 确认数据持续沉淀，支持后续增强

---

## 3. 当前目录结构

```text
~/.openclaw/extensions/shanghainese-local-bridge/
├── data/
│   ├── common-mappings.json
│   ├── correction-lexicon.json
│   ├── confirmed-transcripts.jsonl
│   ├── pending-confirmations.json
│   └── funasr-nano-worker.log
├── openclaw.plugin.json
├── package.json
├── scripts/
│   ├── clean_transcript.py
│   ├── convert_audio_for_asr.py
│   ├── local_asr_funasr_nano_repo.py
│   ├── local_asr_funasr_nano_worker.py
│   └── rewrite_shanghainese_order.py
├── vendor/
│   └── Fun-ASR/
├── index.ts
└── README.md
```

当前运行时需要的脚本、映射、纠错数据和官方 Nano repo 都已收拢到插件目录下。

---

## 4. 快速部署

### 4.1 前置条件

需要本机已具备：
- OpenClaw 已安装并可运行
- Python 3
- 独立 Python venv，例如：`~/.openclaw/venvs/funasr`
- venv 中已安装本插件依赖的 ASR 运行环境
- 插件目录下已包含官方 repo：
  - `vendor/Fun-ASR`

推荐检查：

```bash
python3 --version
~/.openclaw/venvs/funasr/bin/python --version
openclaw gateway status
```

### 4.2 核心脚本

必须存在：
- `scripts/local_asr_funasr_nano_repo.py`
- `scripts/local_asr_funasr_nano_worker.py`
- `scripts/convert_audio_for_asr.py`
- `scripts/clean_transcript.py`
- `scripts/rewrite_shanghainese_order.py`

### 4.3 启用插件

在 OpenClaw 配置中确保插件在 allowlist 中：

```json
{
  "plugins": {
    "allow": [
      "shanghainese-local-bridge"
    ]
  }
}
```

### 4.4 最小配置示例

如果你只想先跑起来，建议先用这个最小可用配置：

```json
{
  "plugins": {
    "entries": {
      "shanghainese-local-bridge": {
        "enabled": true,
        "config": {
          "enabled": true,
          "pythonPath": "~/.openclaw/venvs/funasr/bin/python",
          "nanoRepoScript": "~/.openclaw/extensions/shanghainese-local-bridge/scripts/local_asr_funasr_nano_repo.py",
          "cleanScript": "~/.openclaw/extensions/shanghainese-local-bridge/scripts/clean_transcript.py",
          "rewriteScript": "~/.openclaw/extensions/shanghainese-local-bridge/scripts/rewrite_shanghainese_order.py"
        }
      }
    }
  }
}
```

### 4.5 推荐配置示例

如果你要启用当前完整能力，建议使用：

```json
{
  "plugins": {
    "entries": {
      "shanghainese-local-bridge": {
        "enabled": true,
        "config": {
          "enabled": true,
          "pythonPath": "~/.openclaw/venvs/funasr/bin/python",
          "nanoRepoScript": "~/.openclaw/extensions/shanghainese-local-bridge/scripts/local_asr_funasr_nano_repo.py",
          "cleanScript": "~/.openclaw/extensions/shanghainese-local-bridge/scripts/clean_transcript.py",
          "rewriteScript": "~/.openclaw/extensions/shanghainese-local-bridge/scripts/rewrite_shanghainese_order.py",
          "llmNormalizeEnabled": true,
          "llmNormalizeTimeoutMs": 20000,
          "debugVisibleAgents": ["main"]
        }
      }
    }
  }
}
```

### 4.6 `debugVisibleAgents` 配置说明

`debugVisibleAgents` 用来控制哪些 agent 会显示“确认稿”。

推荐使用方式：
- **第一次部署时，优先开启 debug 模式**
- 先连续发送多条上海话日常用语，观察确认稿结果
- 根据确认结果持续补充映射、规则和个人纠错词典
- 当常用表达已经足够稳定后，再在配置里关闭 debug，进入日常静默使用

行为说明：
- 在清单里的 agent，会看到确认稿，适合做纠偏和调试
- 不在清单里的 agent，默认静默
- 静默模式下仍会使用插件整理后的 transcript 继续对话
- 你也可以指定某一个或多个 agent 专门作为 debug agent 使用
- 插件默认值是：`["main"]`

示例 1，只让主 agent 进入 debug 模式：

```json
{
  "plugins": {
    "entries": {
      "shanghainese-local-bridge": {
        "enabled": true,
        "config": {
          "debugVisibleAgents": ["main"]
        }
      }
    }
  }
}
```

示例 2，让专门 agent 用于 debug：

```json
{
  "plugins": {
    "entries": {
      "shanghainese-local-bridge": {
        "enabled": true,
        "config": {
          "debugVisibleAgents": ["main", "coder"]
        }
      }
    }
  }
}
```

如果你想关闭 debug，可将清单改成不包含当前使用的 agent，或仅保留专门调试的 agent。

### 4.7 重启 OpenClaw

插件配置更新后重启：

```bash
openclaw gateway restart
```

### 4.8 快速自检

建议用一条短语音验证：

1. 发送一条上海话语音
2. 检查是否成功触发本地 ASR
3. 检查是否输出确认稿或静默写回 transcript
4. 回复“确认”，检查是否写入：
   - `data/confirmed-transcripts.jsonl`
   - `data/correction-lexicon.json`

---

## 5. 使用方式

### 5.1 正常使用流程
用户发送一条沪语语音后，插件会返回类似：

```text
【沪语语音确认稿｜本地fun-asr-nano-repo+mapping】
ASR原稿：明朝早朗向八点半。
词典纠偏：明天早上八点半。
建议整理：明天早上八点半。

请直接回复：
1) 发送“确认”，表示采用建议整理
2) 或直接发你认为正确的文字
```

### 5.2 用户确认后
如果用户回复：

```text
明天早上八点半
```

插件会自动：
- 写入 `confirmed-transcripts.jsonl`
- 更新 `correction-lexicon.json`
- 为后续类似句子提供更好的纠偏基础

---

## 6. 数据文件说明

### 6.1 `data/common-mappings.json`
基础上海话常用映射表。

包含三类：
- `time`
- `location`
- `phrase`

适合放高频、稳定、可直接替换的映射。

例如：
- `明朝 -> 明天`
- `后日 -> 后天`
- `下半天 -> 下午`
- `邓坡桥 -> 打浦桥`

### 6.2 `data/correction-lexicon.json`
个人纠偏词典。

来源：
- 用户真实确认样本自动回灌

适合：
- 个人习惯说法
- 个人高频地名/时间表达
- 经过多次确认的错词修正

### 6.3 `data/confirmed-transcripts.jsonl`
确认过的训练/适配样本库。

每行一条 JSON，包含：
- audioPath
- asrDraft
- suggestedText
- confirmedText
- dialect
- tags

该文件是后续：
- 统计分析
- 规则抽取
- 微调数据导出
的重要基础。

---

## 7. 当前性能

基于当前机器的实际测试：

- 模型：`Fun-ASR-Nano-2512`
- 常驻内存：约 **5.5 GB RSS**
- 如果每次重载模型：约 **35 秒 / 3 秒语音**
- 改为常驻 worker 后：
  - 首条热身后约 **2.75 秒**
  - 热态约 **1.74 秒**

结论：
- 本插件的可用性关键在于**常驻 worker**
- 不是音频太长，而是模型加载成本高

---

## 8. 功能优势

### 相比纯 ASR 直出
- 多了一层基础映射表纠偏
- 多了一层个人词典纠偏
- 结果更贴近真实使用

### 相比全靠 LLM 猜
- 更快
- 更稳定
- 更可控
- 更容易持续沉淀规则

### 相比一次性静态规则
- 用户确认会持续积累
- 系统会越来越懂你的说法
- 后续可平滑升级到个性化微调

---

## 9. Roadmap

- 继续扩充高频上海话时间/地点/饭点/口语映射
- 增强规则型语序整理，减少 LLM 触发率
- 增加 phrase-level 模式，而不只是字符串替换
- 积累更多确认样本，支持后续统计分析和可能的个性化训练
- 将 worker 做成更稳定的守护式服务

## 10. 故障排查

### 10.1 worker 拉不起来
先看：

```bash
cat ~/.openclaw/extensions/shanghainese-local-bridge/data/funasr-nano-worker.log
```

常见原因：
- `Fun-ASR` repo 不存在
- Python venv 路径不对
- `tiktoken` / `openai-whisper` 未安装
- `ffmpeg` 路径未带入 worker 环境

### 10.2 模型找不到
检查目录：

```bash
ls ~/.cache/modelscope/hub/models/FunAudioLLM/Fun-ASR-Nano-2512
```

如果没有，说明模型还没下载完成，或当前运行用户无权限访问缓存目录。

### 10.3 转写仍然很慢
如果单条又回到 30 秒以上，通常说明没有走常驻 worker，而是退回了 direct-repo 模式。

可检查 wrapper 输出中的：
- `mode: persistent-worker`
- 如果不是这个值，说明 worker 未被成功复用

### 10.4 ffmpeg 相关报错
当前方案依赖 venv 内的 ffmpeg 路径：

```text
~/.openclaw/venvs/funasr/bin/ffmpeg
```

如果缺失，需要重新确认：
- `imageio-ffmpeg` 已安装
- venv 内 ffmpeg 入口存在

### 10.5 规则明明录入了却没命中
检查两个文件：

```bash
cat ~/.openclaw/extensions/shanghainese-local-bridge/data/common-mappings.json
cat ~/.openclaw/extensions/shanghainese-local-bridge/data/correction-lexicon.json
```

常见原因：
- 词形不完全一致
- 当前是整句级误识别，不适合做简单字符串替换
- 新规则虽然已确认，但还没有形成稳定短词映射

### 10.6 用户确认没有自动入库
检查：
- 插件是否已加载 `message:received` hook
- 回复是否发生在待确认有效期内
- 回复内容是否不是命令

可检查文件：

```bash
cat ~/.openclaw/extensions/shanghainese-local-bridge/data/pending-confirmations.json
cat ~/.openclaw/extensions/shanghainese-local-bridge/data/confirmed-transcripts.jsonl
```
