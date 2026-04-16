# Shanghainese Local Bridge

A local Shanghainese/Wu voice-input bridge for OpenClaw.

本插件为 OpenClaw 提供一个面向**上海话 / 沪语短语音**的本地语音转写与后处理链路。

当前设计目标不是“完美自动定稿”，而是先做到：
- 本地 ASR 可用
- 后处理可控
- 用户确认可积累
- 映射表可持续增强
- 后续可演进到个人化适配 / 微调

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

当前链路：

```text
Telegram/频道语音
-> message:transcribed
-> Fun-ASR-Nano-2512 本地常驻 worker
-> common-mappings.json 基础映射纠偏
-> correction-lexicon.json 个人纠偏词典回灌
-> clean_transcript.py 轻清洗
-> 输出确认稿给用户
-> 用户回复“确认”或直接给出正确文本
-> 自动写入 confirmed-transcripts.jsonl 并更新 correction-lexicon.json
```

流程图版本：

```text
[用户发送沪语语音]
        |
        v
[OpenClaw message:transcribed]
        |
        v
[Fun-ASR-Nano-2512 常驻 worker]
        |
        v
[基础映射 common-mappings.json]
        |
        v
[个人词典 correction-lexicon.json]
        |
        v
[clean_transcript.py 轻清洗]
        |
        v
[输出确认稿]
        |
        +----------------------+
        |                      |
        v                      v
   [用户回复确认]         [用户直接改正文本]
        |                      |
        +----------+-----------+
                   |
                   v
[自动写入 confirmed-transcripts.jsonl]
                   |
                   v
[更新 correction-lexicon.json]
```

也就是说，这个插件现在是一个**确认式沪语语音纠偏插件**。

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

当前推荐链路：

```text
本地 Fun-ASR-Nano-2512
-> 基础映射纠偏
-> 个人词典回灌纠偏
-> 轻清洗
-> 规则型语序整理
-> 必要时 LLM 普通话化
-> 用户确认
-> 确认结果回流数据文件
```

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

这一节按“拿到仓库后尽快跑起来”的思路写，适合直接放到 GitHub。

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

### 4.2 目录准备

将插件放到：

```text
~/.openclaw/extensions/shanghainese-local-bridge/
```

并确保目录中至少包含：

```text
shanghainese-local-bridge/
├── data/
├── scripts/
├── vendor/Fun-ASR/
├── index.ts
├── openclaw.plugin.json
└── README.md
```

### 4.3 核心脚本

必须存在：
- `scripts/local_asr_funasr_nano_repo.py`
- `scripts/local_asr_funasr_nano_worker.py`
- `scripts/convert_audio_for_asr.py`
- `scripts/clean_transcript.py`
- `scripts/rewrite_shanghainese_order.py`

### 4.4 启用插件

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

### 4.5 最小配置示例

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

### 4.6 推荐配置示例

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
          "debugVisibleAgents": ["main", "coder"]
        }
      }
    }
  }
}
```

### 4.7 `debugVisibleAgents` 配置说明

`debugVisibleAgents` 用来控制哪些 agent 会显示“确认稿”。

例如：

```json
{
  "plugins": {
    "entries": {
      "shanghainese-local-bridge": {
        "enabled": true,
        "config": {
          "debugVisibleAgents": ["main", "bazi", "coder"]
        }
      }
    }
  }
}
```

行为说明：
- 在清单里的 agent，会看到确认稿
- 不在清单里的 agent，默认静默
- 静默模式下仍会使用插件整理后的 transcript 继续对话
- 插件默认值是：`["main"]`
- 当前这台机器的实际配置是：`["main", "coder"]`

### 4.8 重启 OpenClaw

插件配置更新后重启：

```bash
openclaw gateway restart
```

### 4.9 快速自检

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

## 9. 当前限制

目前仍有这些限制：

1. **沪语 ASR 仍不完美**
   - 某些整句仍会严重误识别
   - 例如整句语义跨度过大时，单靠字符串替换不够

2. **映射表适合高频稳定模式**
   - 不适合处理所有整句级复杂误识别

3. **当前是确认式流程**
   - 目标是“先可用”，不是“全自动无校对”

4. **Nano 常驻占用较高内存**
   - 约 5.5 GB RSS

---

## 10. 推荐运维策略

### 推荐
- 让 Nano worker 常驻
- 持续积累确认样本
- 优先扩充：
  - 时间表达
  - 地名
  - 高频口语词

### 不推荐
- 过早追求全自动无确认
- 对整句级复杂误识别做大规模硬替换
- 把低置信度长句直接写死为全局规则

---

## 11. 后续可扩展方向

### 11.1 更强映射层
- 按类别拆分：
  - `time-mapping.json`
  - `location-mapping.json`
  - `phrase-level-examples.jsonl`

### 11.2 个人化纠偏增强
- 按确认次数提升规则优先级
- 增加地名 / 时间 / 口语分层策略
- 引入置信度和替换条件

### 11.3 微调数据导出
- 从 `confirmed-transcripts.jsonl` 导出训练 manifest
- 形成真正可复用的个人语音数据集

### 11.4 更深层 ASR 服务化
- 将 worker 做成系统服务
- 增加健康检查、自动拉起、超时恢复
- 支持并发请求与缓存

---

## Roadmap

后续建议演进方向：
- 继续扩充高频上海话时间/地点/饭点/口语映射
- 增强规则型语序整理，减少 LLM 触发率
- 增加 phrase-level 模式，而不只是字符串替换
- 积累更多确认样本，支持后续统计分析和可能的个性化训练
- 将 worker 做成更稳定的守护式服务

## 12. 故障排查

### 12.1 worker 拉不起来
先看：

```bash
cat ~/.openclaw/extensions/shanghainese-local-bridge/data/funasr-nano-worker.log
```

常见原因：
- `Fun-ASR` repo 不存在
- Python venv 路径不对
- `tiktoken` / `openai-whisper` 未安装
- `ffmpeg` 路径未带入 worker 环境

### 12.2 模型找不到
检查目录：

```bash
ls ~/.cache/modelscope/hub/models/FunAudioLLM/Fun-ASR-Nano-2512
```

如果没有，说明模型还没下载完成，或当前运行用户无权限访问缓存目录。

### 12.3 转写仍然很慢
如果单条又回到 30 秒以上，通常说明没有走常驻 worker，而是退回了 direct-repo 模式。

可检查 wrapper 输出中的：
- `mode: persistent-worker`
- 如果不是这个值，说明 worker 未被成功复用

### 12.4 ffmpeg 相关报错
当前方案依赖 venv 内的 ffmpeg 路径：

```text
~/.openclaw/venvs/funasr/bin/ffmpeg
```

如果缺失，需要重新确认：
- `imageio-ffmpeg` 已安装
- venv 内 ffmpeg 入口存在

### 12.5 规则明明录入了却没命中
检查两个文件：

```bash
cat ~/.openclaw/extensions/shanghainese-local-bridge/data/common-mappings.json
cat ~/.openclaw/extensions/shanghainese-local-bridge/data/correction-lexicon.json
```

常见原因：
- 词形不完全一致
- 当前是整句级误识别，不适合做简单字符串替换
- 新规则虽然已确认，但还没有形成稳定短词映射

### 12.6 用户确认没有自动入库
检查：
- 插件是否已加载 `message:received` hook
- 回复是否发生在待确认有效期内
- 回复内容是否不是命令

可检查文件：

```bash
cat ~/.openclaw/extensions/shanghainese-local-bridge/data/pending-confirmations.json
cat ~/.openclaw/extensions/shanghainese-local-bridge/data/confirmed-transcripts.jsonl
```

## 13. 插件与 Skill 的职责边界

为了避免后续能力越做越混，推荐明确分工如下。

### 13.1 插件负责什么
插件负责**实时在线链路**，也就是用户发来语音后立刻发生的事情：

- 接收 `message:transcribed` / `message:received` 事件
- 调用本地 Fun-ASR-Nano 常驻 worker
- 执行映射表纠偏
- 执行个人词典回灌
- 执行轻清洗
- 执行规则型语序整理
- 可选执行 LLM 普通话化
- 输出确认稿
- 自动记录用户确认结果

一句话说，插件负责：

**在线、实时、面向用户会话的沪语语音输入处理。**

### 13.2 Skill 负责什么
Skill 不负责实时接管消息链路，而更适合负责：

- 部署说明
- 架构说明
- 调试说明
- 离线脚本入口
- 批量语料处理
- 训练数据整理
- 评测与对比实验
- 参考样例沉淀

一句话说，Skill 负责：

**说明、复用、离线处理、开发辅助。**

### 13.3 当前推荐架构
当前推荐保持：

- **插件** 作为正式语音输入入口
- **Skill** 作为配套说明和离线工具层

不要让 Skill 承担实时对话链路，也不要把所有批处理/实验逻辑都塞进插件。

### 13.4 为什么这样分工
这样做有几个直接好处：

1. **实时链路更稳定**
   - 插件只做在线必要动作

2. **离线能力更容易迭代**
   - Skill 可以继续扩展脚本、文档和实验流程

3. **维护成本更低**
   - 出问题时能快速判断是“线上插件问题”还是“离线工具问题”

4. **便于后续复用**
   - 以后如果要把这套上海话处理能力迁移到别的 agent / 别的项目，Skill 层更容易复用

### 13.5 结论
对于这个项目，建议长期坚持这条边界：

- **插件 = 正式在线输入链路**
- **Skill = 文档、脚本、批处理、开发辅助**

## 14. 一句话总结

`Shanghainese Local Bridge` 不是一个“单次转写脚本”，而是一条可持续成长的沪语短语音处理链：

**本地 Nano ASR + 常驻提速 + 映射表纠偏 + 用户确认回流 + 个性化积累**

它的优势不只是“能转写”，而是**越用越懂你**。
