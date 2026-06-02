---
license: mit
pipeline_tag: any-to-any
tags:
- Audio-to-Text
- Text-to-Audio
- Audio-to-Audio
- Text-to-Text
- Audio-Text-to-Text
---
<div align="center">
  <picture>
    <source srcset="https://github.com/XiaomiMiMo/MiMo-VL/raw/main/figures/Xiaomi_MiMo_darkmode.png?raw=true" media="(prefers-color-scheme: dark)">
    <img src="https://github.com/XiaomiMiMo/MiMo-VL/raw/main/figures/Xiaomi_MiMo.png?raw=true" width="60%" alt="Xiaomi-MiMo" />
  </picture>
</div>

<h3 align="center">
  <b>
    <span>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>
    <br/>
    MiMo Audio: Audio Language Models are Few-Shot Learners
    <br/>
    <span>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</span>
    <br/>
  </b>
</h3>

<br/>

<div align="center" style="line-height: 1;">
  |
  <a href="https://github.com/XiaomiMiMo/MiMo-Audio" target="_blank">🤖 GitHub</a>
  &nbsp;|
  <a href="https://github.com/XiaomiMiMo/MiMo-Audio/blob/main/MiMo-Audio-Technical-Report.pdf" target="_blank">📄 Paper</a>
  &nbsp;|
  <a href="https://xiaomimimo.github.io/MiMo-Audio-Demo" target="_blank">📰 Blog</a>
  &nbsp;|
  <a href="https://huggingface.co/spaces/XiaomiMiMo/mimo_audio_chat" target="_blank">🔥 Online Demo</a>
  &nbsp;|
  <a href="https://github.com/XiaomiMiMo/MiMo-Audio-Eval" target="_blank">📊 MiMo-Audio-Eval</a>
  &nbsp;|

  <br/>
</div>

<br/>

## Introduction

Existing audio language models typically rely on task-specific fine-tuning to accomplish particular audio tasks. In contrast, humans are able to generalize to new audio tasks with only a few examples or simple instructions. GPT-3 has shown that scaling next-token prediction pretraining enables strong generalization capabilities in text, and we believe this paradigm is equally applicable to the audio domain. By scaling MiMo-Audio's pretraining data to over one hundred million of hours, we observe the emergence of few-shot learning capabilities across a diverse set of audio tasks. We develop a systematic evaluation of these capabilities and find that MiMo-Audio-7B-Base achieves SOTA performance on both speech intelligence and audio understanding benchmarks among open-source models. Beyond standard metrics, MiMo-Audio-7B-Base generalizes to tasks absent from its training data, such as voice conversion, style transfer, and speech editing. MiMo-Audio-7B-Base also demonstrates powerful speech continuation capabilities, capable of generating highly realistic talk shows, recitations, livestreaming and debates. At the post-training stage, we curate a diverse instruction-tuning corpus and introduce thinking mechanisms into both audio understanding and generation. MiMo-Audio-7B-Instruct achieves open-source SOTA on audio understanding benchmarks, spoken dialogue benchmarks and instruct-TTS evaluations, approaching or surpassing closed-source models.

<p align="center">
  <img width="95%" src="https://github.com/XiaomiMiMo/MiMo-Audio/blob/main/assets/Results.png?raw=true">
</p>



## Architecture
### MiMo-Audio-Tokenizer
MiMo-Audio-Tokenizer is a 1.2B-parameter Transformer operating at 25 Hz. It employs an eight-layer RVQ stack to generate 200 tokens per second. By jointly optimizing semantic and reconstruction objectives, we train MiMo-Audio-Tokenizer from scratch on a 10-million-hour corpus, achieving superior reconstruction quality and facilitating downstream language modeling.

<p align="center">
  <img width="95%" src="https://github.com/XiaomiMiMo/MiMo-Audio/blob/main/assets/tokenizer.png?raw=true">
</p>

MiMo-Audio couples a patch encoder, an LLM, and a patch decoder to improve modeling efficiency for high-rate sequences and bridge the length mismatch between speech and text. The patch encoder aggregates four consecutive time steps of RVQ tokens into a single patch, downsampling the sequence to a 6.25 Hz representation for the LLM. The patch decoder autoregressively generates the full 25 Hz RVQ token sequence via a delayed-generation scheme.
### MiMo-Audio
<p align="center">
  <img width="95%" src="https://github.com/XiaomiMiMo/MiMo-Audio/blob/main/assets/architecture.png?raw=true">
</p>

##  Explore MiMo-Audio Now! 🚀🚀🚀
- 🎧 **Try the Hugging Face demo:** [MiMo-Audio Demo](https://huggingface.co/spaces/XiaomiMiMo/mimo_audio_chat)
- 📰 **Read the Official Blog:** [MiMo-Audio Blog](https://xiaomimimo.github.io/MiMo-Audio-Demo)
- 📄 **Dive into the Technical Report:** [MiMo-Audio Technical Report](https://github.com/XiaomiMiMo/MiMo-Audio/blob/main/MiMo-Audio-Technical-Report.pdf)


## Model Download
| Models   | 🤗 Hugging Face |
|-------|-------|
| MiMo-Audio-Tokenizer | [XiaomiMiMo/MiMo-Audio-Tokenizer](https://huggingface.co/XiaomiMiMo/MiMo-Audio-Tokenizer) |
| MiMo-Audio-7B-Base | [XiaomiMiMo/MiMo-Audio-7B-Base](https://huggingface.co/XiaomiMiMo/MiMo-Audio-7B-Base) |
| MiMo-Audio-7B-Instruct | [XiaomiMiMo/MiMo-Audio-7B-Instruct](https://huggingface.co/XiaomiMiMo/MiMo-Audio-7B-Instruct) |


```bash
pip install huggingface-hub

hf download XiaomiMiMo/MiMo-Audio-Tokenizer --local-dir ./models/MiMo-Audio-Tokenizer
hf download XiaomiMiMo/MiMo-Audio-7B-Base --local-dir ./models/MiMo-Audio-7B-Base
hf download XiaomiMiMo/MiMo-Audio-7B-Instruct --local-dir ./models/MiMo-Audio-7B-Instruct
```

## Getting Started

Spin up the MiMo-Audio demo in minutes with the built-in Gradio app.

### Prerequisites (Linux)

* Python 3.12
* CUDA >= 12.0

### Installation

```bash
git clone https://github.com/XiaomiMiMo/MiMo-Audio.git
cd MiMo-Audio
pip install -r requirements.txt
pip install flash-attn==2.7.4.post1
```

> \[!Note]
> If the compilation of flash-attn takes too long, you can download the precompiled wheel and install it manually:
>
> * [Download Precompiled Wheel](https://github.com/Dao-AILab/flash-attention/releases/download/v2.7.4.post1/flash_attn-2.7.4.post1+cu12torch2.6cxx11abiFALSE-cp312-cp312-linux_x86_64.whl)
>
> ```sh
> pip install /path/to/flash_attn-2.7.4.post1+cu12torch2.6cxx11abiFALSE-cp312-cp312-linux_x86_64.whl
> ```


### Run the demo
``` sh
python run_mimo_audio.py
```

This launches a local Gradio interface where you can try MiMo-Audio interactively.

<p align="center">
  <img width="95%" src="https://github.com/XiaomiMiMo/MiMo-Audio/blob/main/assets/demo_ui.jpg?raw=true">
</p>

Enter the local paths for `MiMo-Audio-Tokenizer` and `MiMo-Audio-7B-Instruct`, then enjoy the full functionality of MiMo-Audio!

## Inference Scripts

### Base Model
We provide an example script to explore the **in-context learning** capabilities of `MiMo-Audio-7B-Base`.  
See: [`inference_example_pretrain.py`](https://github.com/XiaomiMiMo/MiMo-Audio/blob/main/inference_example_pretrain.py)

### Instruct Model
To try the instruction-tuned model `MiMo-Audio-7B-Instruct`, use the corresponding inference script.  
See: [`inference_example_sft.py`](https://github.com/XiaomiMiMo/MiMo-Audio/blob/main/inference_example_sft.py)



## Evaluation Toolkit
Full evaluation suite are available at 🌐[MiMo-Audio-Eval](https://github.com/XiaomiMiMo/MiMo-Audio-Eval).


This toolkit is designed to evaluate MiMo-Audio and other recent audio LLMs as mentioned in the paper. It provides a flexible and extensible framework, supporting a wide range of datasets, tasks, and models.

## Citation

```bibtex
@misc{coreteam2025mimoaudio,
      title={MiMo-Audio: Audio Language Models are Few-Shot Learners}, 
      author={LLM-Core-Team Xiaomi},
      year={2025},
      url={GitHub - XiaomiMiMo/MiMo-Audio}, 
}
```


## Contact

Please contact us at [mimo@xiaomi.com](mailto:mimo@xiaomi.com) or open an issue if you have any questions.

---

# ECDICT 英语词典 + MiMo-Audio-7B 批量TTS系统

## 一、项目概览
本项目包含两个主要功能：
1. 原始的ECDICT英语词典查询系统
2. 基于MiMo-Audio-7B的批量英语单词TTS语音合成系统

---

## 二、目录结构

```
ECDICT-master/
├── models/                    # MiMo-Audio-7B模型文件目录
├── scripts/                   # TTS相关脚本目录
├── bat_files/                 # 批处理文件目录（所有.bat文件）
├── tts_output/                # TTS生成的音频输出目录
├── pronunciations/            # 预生成的发音文件目录（原系统使用）
├── 启动词典系统.bat             # 根目录快捷启动词典系统
├── 批量生成发音.bat             # 根目录快捷启动批量TTS
├── README.md                  # 本文件（完整项目说明）
├── LICENSE                   # 许可证
├── app.py                    # Flask词典服务器（必须在根目录）
├── dictutils.py              # 词典工具类（必须在根目录）
├── linguist.py               # 语言处理工具（必须在根目录）
├── del_bfz.py                # 清理bfz文件的脚本
├── ecdict.csv                # 完整词典数据（77万单词，必须在根目录）
├── ecdict.mini.csv           # 精简版词典数据（必须在根目录）
└── lemma.en.txt              # 英语词干数据（必须在根目录）
```

---

## 三、模型相关目录 - models/

### 1. 核心模型权重文件
- **model-00001-of-00004.safetensors** - 模型权重文件第1部分
- **model-00002-of-00004.safetensors** - 模型权重文件第2部分
- **model-00003-of-00004.safetensors** - 模型权重文件第3部分
- **model-00004-of-00004.safetensors** - 模型权重文件第4部分
- **model.safetensors.index.json** - 模型权重索引文件，用于加载分片模型

### 2. 模型配置文件
- **config.json** - 模型架构和配置参数（层数、隐藏层维度、注意力头等）
- **tokenizer.json** - 分词器的完整配置
- **vocab.json** - 词汇表文件
- **tokenizer_config.json** - 分词器配置
- **special_tokens_map.json** - 特殊token映射
- **added_tokens.json** - 额外添加的token
- **merges.txt** - 用于字节级BPE的合并规则

---

## 四、TTS脚本目录 - scripts/

### 1. TTS核心脚本
- **batch_tts.py** - 批量TTS脚本核心文件
  - 功能：使用动态INT4量化加载模型，批量生成英文单词音频
  - 特点：自动跳过已生成文件、支持断点续传、显存优化
  - 路径：使用BASE_DIR自动计算相对路径，无需修改

### 2. 工具脚本
- **download_model.py** - 模型下载脚本（已使用，保留参考）

---

## 五、批处理文件目录 - bat_files/

### 1. 词典系统启动脚本
- **start.bat** - 完整启动词典系统（中文界面）
  - 功能：检查Python环境、检查Flask依赖、检查词典文件、启动服务器
  - 使用：一般通过根目录的"启动词典系统.bat"调用
  
- **start_simple.bat** - 完整启动词典系统（英文界面）
  - 功能：与start.bat相同，只是界面语言为英文
  
- **快速启动.bat** - 快速启动词典系统（跳过检查）
  - 功能：直接启动app.py，跳过环境检查
  - 适合：已经确认环境配置正确的用户

### 2. 批量TTS启动脚本
- **run_batch_tts.bat** - 批量TTS启动脚本
  - 功能：检查Python环境、安装必要依赖、运行batch_tts.py
  - 使用：一般通过根目录的"批量生成发音.bat"调用

⚠️ **注意**：此目录存放所有批处理脚本，建议通过根目录的快捷脚本启动

---

## 六、TTS输出目录 - tts_output/

- 存放批量生成的音频文件
- 文件命名规则：`{单词}.mp3`

---

## 七、原始ECDICT词典系统

### 1. 核心脚本
- **app.py** - Flask后端服务器
  - 功能：提供词典查询API、发音文件服务、模糊匹配等功能
  - 运行方式：`python app.py`
  - ⚠️ **注意**：路径已保持不变，可正常工作

- **dictutils.py** - 词典工具类
  - 功能：读取和处理词典数据

- **linguist.py** - 语言处理工具
  - 功能：词干提取、词根分析等

### 2. 词典数据
- **ecdict.csv** - 完整词典数据（77万单词）
  - 格式：CSV文件，包含单词、音标、释义、翻译等信息
- **ecdict.mini.csv** - 精简版词典数据（测试用）
- **lemma.en.txt** - 英语词干数据

### 3. 其他工具
- **del_bfz.py** - 清理bfz文件的脚本

### 4. 静态资源
- **pronunciations/** - 预生成的发音文件目录
  - 包含已有单词的英式（_uk.mp3）和美式（_us.mp3）发音
  - ⚠️ **注意**：原始词典系统仍使用此目录

---

## 八、根目录快捷启动脚本

### 1. **启动词典系统.bat** - 启动ECDICT英语词典系统
- 功能：一键启动词典查询系统
- 使用方法：直接双击此文件
- 特点：自动跳转到bat_files目录并调用start.bat

### 2. **批量生成发音.bat** - 启动批量TTS语音合成
- 功能：一键启动批量英文单词发音生成
- 使用方法：直接双击此文件
- 特点：自动跳转到bat_files目录并调用run_batch_tts.bat

---

## 九、重要说明 - 主程序依赖文件位置

### ⚠️ 必须保持在根目录的文件（词典系统需要）
以下文件**绝对不能移动**，否则词典系统将无法正常工作：

- **app.py** - Flask词典服务器主程序
- **dictutils.py** - 词典数据读取工具
- **linguist.py** - 语言处理工具
- **ecdict.csv** - 完整词典数据库（77万单词）
- **ecdict.mini.csv** - 精简版词典数据库
- **lemma.en.txt** - 英语词干数据
- **pronunciations/** - 预生成发音文件目录

### ✅ 已整理到子目录的文件（安全）
以下文件已整理到子目录，不影响主程序运行：
- 所有模型文件 → models/
- TTS脚本 → scripts/
- 批处理脚本 → bat_files/
- TTS输出 → tts_output/

---

## 十、使用指南

### 批量生成单词发音
1. 确保所有依赖已安装（首次运行会自动安装）
2. 双击根目录的 **`批量生成发音.bat`** 文件
3. 等待生成完成，音频文件会保存在 `tts_output/` 目录

### 使用词典系统
1. 双击根目录的 **`启动词典系统.bat`** 文件
2. 或者直接运行 `python app.py`
3. 浏览器会自动打开词典网页界面
4. ⚠️ **注意**：词典系统功能完全不受目录整理影响

---

## 十一、依赖库说明
已安装的关键依赖：
- **transformers** - 用于加载和使用预训练模型
- **bitsandbytes** - 用于4位量化，减少显存占用
- **torch** - PyTorch深度学习框架
- **soundfile** - 用于音频文件读写
- **datasets** - 用于数据处理
- **flask** - Web框架（用于词典系统）

---

## 十二、路径兼容性说明

✅ **所有程序已正确更新路径，不会出现找不到文件的问题：**

1. **TTS系统** - 使用BASE_DIR自动计算相对路径
2. **词典系统** - 所有核心文件保持在原位置，功能完全正常
3. **批处理脚本** - 使用`%~dp0`自动获取脚本所在目录

---

## 十三、注意事项

- 不要删除或移动models/目录下的文件
- tts_output/目录会自动创建（如果不存在）
- 已生成的音频文件会自动跳过，支持断点续传
- 原始词典系统的pronunciations/目录保持不变
- bat_files/目录存放所有批处理脚本，根目录仅保留快捷启动脚本
- ⚠️ **重要**：app.py、dictutils.py、linguist.py、ecdict.csv等核心文件必须保持在根目录！
