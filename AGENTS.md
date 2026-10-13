# AGENTS.md — 律动工坊（GrooveLab）项目记忆

开始任务前先读本文件，再读 `方案.md`（完整产品方案，审核稿）。

## 1. 项目是什么

流行 / 摇滚乐理学习网站。终点：学生能独立作曲并编曲一首 2–3 分钟、4–6 轨的作品。
纯前端，Local-first，**只面向电脑端 Chrome**，界面只做中文。当前版本 **0.8.0（吉他工坊 G3：主音吉他单元 5–8、即兴分析与存入作品集、AI 吉他专项与即兴点评、每日训练 / 技能地图 / 徽章接入）**。吉他工坊三期全部完成。0.9.0 加入曲库与谱子导入。0.10.0：随站钢琴采样作训练音色、未完成训练可继续、答案揭示带八度与顺序、蓝牙耳机吞音修复。0.11.0：侧边栏「我的谱子」+ Guitar Pro 导入（alphaTab）。0.12.0：课后实操。0.13.0：谱子的原曲伴奏（D-1，导入 UVR 分好的轨道）。0.14.0：跟唱练音准（D-2）。0.15.0：一键自动分轨（D-3：本机助手 + 浏览器内）。D 期全部完成，计划见 `方案-1.0.md`。0.16.0：跟唱 2.0（`方案-跟唱2.0.md`：回看每句、录音回放、按音符评分、歌词、完整版、后期工作台）。指弹板块待做。原方案五期已完成，吉他工坊分 G1–G3 进行中，指弹另做板块。

## 2. 工程原则

- 分层：UI → features（hooks / store）→ services → IndexedDB（Dexie）。UI 不直接碰数据库。
- 所有题目**本地参数化生成**（带 seed，可复现），判分本地完成，不依赖 AI。
- 掌握度是**基于练习记录的估计**；措辞不断言能力（「可能需要多练的部分」）。
- 音频永不离开浏览器；AI 只收符号化数据。API Key 用 AES-GCM 设备密钥加密存储。
- 颜色全部走 `src/shared/styles/globals.css` 的 CSS 变量，组件不写字面颜色。Tailwind 颜色带 `<alpha-value>`，可用 `/15` 等透明度。
- 完成任务后必须跑：`npm run lint`、`npm run typecheck`、`npm test`。

## 3. 目录

```text
src/
  music/        纯乐理：pitch / intervals / scales / chords / keys（含流行摇滚进行库与副属）/ rhythm / random
                / melody（旋律生成）/ spelling（音名拼写）/ fretboard（指板、把位、和弦指法）
                / score（统一乐谱模型：段落、移调、和弦色彩、轨道）/ jianpu（简谱排版，纯函数）
                / arrangement（轨道、风格模板、自动声部生成、段落能量）/ accompaniment（旧接口兼容层）
  analysis/     ruleEngine.ts（规则引擎 v1，支持移调段落与和弦色彩）· arrangementRules.ts（编曲检查）
  drills/       训练模块定义、级别表、出题器、判分、技能 id
  audio/        engine.ts（训练音色与作用域覆盖、节拍器、音频时钟、输出延迟、防吞音）· piano.ts（随站 Salamander 采样、同采样变调、响度归一）· rig.ts（每次播放构建的多轨乐器组）
  export/       midi.ts · musicxml.ts · wav.ts（Tone.Offline 离线渲染）· download.ts
  audio/pitch/  yin.ts（YIN 基频）· analysis.ts（稳定段、音分、窗口测量，纯函数）· detector.ts（麦克风）
  course/       课程数据（types、stages、lessons/stage0–5）与规则（rules.ts：解锁、微创作检查、checkSong 含进阶和声与编曲检查）
  entities/     数据类型
  infrastructure/ db(Dexie v3) ai(provider + prompts/ 五个家族 + 注册表 index.ts) crypto logger errors
  audio/input/  devices.ts（吉他线识别、设备组合键，纯函数）· inputManager.ts（全站共享输入：稳定的 bus 节点、选设备、输出设备 setSinkId）
  audio/guitar/ rigSettings（十级效果设置、五个预设、校验）· dsp（失真曲线、混响冲击响应、噪声门算法、worklet 源码）· chain（Web Audio 效果链）· monitor · worklets
  audio/onset/  onset.ts（起音检测，纯函数）· onsetListener.ts（音频线程采样 → 检测）
  audio/latency.ts 延迟估算与校准统计
  audio/chroma.ts 和弦识别提示（频谱折叠成 12 音级 + 和弦模板，纯函数）
  guitar/       strum（节奏型、多段落、反拍与换和弦子分）· checks（和弦检查、换和弦计数）· technique（推弦、揉弦分析）
                · scales（五声把位、大调音阶窗口、原创句型含连奏、认音找音题）· improv（音符切分、即兴统计、瞄准和弦音、转成乐谱）
                · units（吉他工坊课程数据，16 个单元）
  import/       chordSymbols（和弦名 → 级数 + 色彩 / 转位，调性猜测）· chordChart（文本和弦谱）· midiImport · musicxmlImport · unzip（.mxl）· asciiTab
  songs/        jianpuParse（曲库用的简谱记法）· library（16 首公有领域与原创曲目）· practice（乐谱 → 扫弦和弦表 / 旋律六线谱）
  pwa/          sw-template.js（构建时由 vite.config.ts 注入文件清单与版本，输出 /sw.js）
  services/     drill / mastery / moduleProgress / dailyPlan / placement / profile / badge / settings / data（导出 + 导入）
                / ai/aiClient（getAI、可操作错误提示）· ai/validate（全部 AI 输出的本地校验、不代写检测）
                / exercise（AI 专项练习）/ confusion / advice（本周重点）/ critique（点评）/ lessonQA / graduation
                / review（间隔重复）/ course（课程进度、作品集）
  features/     zustand store：profile / theme / toast；useAudio；instrument/useGuitarSetup（调弦、变调夹、和弦指型）
  widgets/      drill(QuestionView / RhythmPad / DictationInput / DrillRunner / Oscilloscope) keyboard
                notation(RhythmStaff / MelodyStaff / JianpuView / TabView / ScoreNotation) instrument(Fretboard / ChordDiagram / InstrumentView)
                studio(StudioEditor / PianoRoll / ChordTrack 调色板 / AnalysisPanel / ArrangeEditor / TrackRoll + DrumGrid / ExportPanel)
                pitch(PerformPad / TunerGauge / RangeCalibration) compose(MiniComposer) lesson meter brand settings
  pages/        Landing / Onboarding / Placement / Camp / Module / Drill / Course / Lesson / Studio / Portfolio / Tuner / Skills / Settings
                / AIPractice（/camp/ai）/ Graduation（/graduation）
tests/          music / drills / services / p2（YIN、分析、新模块）/ p3（乐谱模型、简谱、规则引擎、伴奏）/ course（课程、复习、每日计划、创作可完成性）
                / p5（AI 校验、题目构建、点评摘要、版本、备份、毕业检查、发声分配）/ p5ai（假 AI 下的完整流程）/ pwa（模拟 worker 环境）
                / p4（和弦色彩、移调、编曲、编曲检查、三种导出、阶段 4–5 课程、借用和弦拼写）
```

## 4. 关键设计

- **训练模块（23 个）**：听辨 E1–E9（音高比较、音程、级数、音阶调式、和弦性质、和声进行、低音线、旋律听写、节奏听写）；节奏 R1–R3；唱 S1–S7（单音、长音、音程、音阶、级数、视唱、模唱）；读谱 N1 五线谱识谱、T1 乐理知识；乐器 I1 主乐器、I2 第二乐器。P1 级别在 `drills/levels.ts`，P2 级别在 `drills/levelsP2.ts`；P2 出题与判分在 `generatorsP2.ts` / `gradingP2.ts` / `theory.ts`。
- **音准检测**：AnalyserNode + YIN（主线程约 40 帧/秒，未用 AudioWorklet，桌面 Chrome 足够），噪声门 + 清晰度阈值 + 5 帧中值平滑；只对稳定段评分。帧时间减去输出延迟 + 30ms 对齐。自由节奏题（S1/S2/S3/S5、找音）取最长稳定段，听到足够稳定的音会自动结束；定拍题（S4/S6/S7、乐器音阶/旋律/分解和弦）按每个目标音的时间窗测量，跳过前 20% 起音。麦克风信号不连扬声器、不录音、不上传。
- **音域**：首次唱歌练习前强制标定（最低、最高舒适音各稳住约 1 秒，最高音须比最低音高 ≥3 个半音）；目标音放在音域内。八度等价默认开（S1/S3/S5），音阶、视唱、模唱始终按准确音高。
- **乐器**：I1/I2 用麦克风检测单音（贝斯窗口 4096、下限 30Hz）；和弦整体不做自动判定，改为分解弹奏逐音检测。指板指法先找 4 品手型框，失败再用动态规划。
- **间隔重复**：每次作答按技能写入 `reviewItems`（SM-2：错 → 1 小时后，对 → 1 天、3 天、间隔×ease）。到期技能进入出题偏向和每日训练排序。
- **课程**：阶段 0（8 课）、阶段 1（10 课），每课 = 讲解块 + 课内练习（复用 DrillRunner）+ 微创作（MiniComposer，节奏八分格或旋律四分格，按 `CreationCheck` 校验）。所有课内练习通过且微创作已保存 → 完成（+30 XP）。解锁下一阶段 = 当前阶段课程全部完成 + 下一阶段训练门槛（“通过某模块第 N 级” = 已解锁第 N+1 级）。阶段 0–5 共 60 课全部上线。
- **每日训练（PLAN_VERSION 4）**：3 个听辨/读谱 + 1 节奏 + 1 唱。**乐器任务（I1 / I2）和吉他工坊是学生自选的，不进每日训练**（用户决定）。`PLAN_PREREQ` 控制难模块何时进入计划。旧版本且未开始的当日计划自动重建；已开始的旧计划保留进度、只去掉乐器 / 吉他项。
- **统一乐谱模型（music/score.ts）**：`Score` = 调（keyTonic + mode）、速度、小节数、单声部旋律（start/beats/midi/lyric，不跨小节）、和弦槽（罗马数字）、伴奏设置。`scoreEvents()` 把旋律补齐休止并切成可绘制的时值，五线谱 / 简谱 / 六线谱三个视图都画同一份事件，所以互切不丢内容。
- **记谱视图**：五线谱（VexFlow，支持和弦名与歌词）、简谱（自研 SVG，首调，小调用关系大调的 1，八度点、减时线、增时线、附点）、六线谱 / 四线谱（VexFlow TabStave，指法来自手型框搜索）。`ScoreNotation` 带切换器；`useNotationViews`：阶段 0–1 只开放五线谱，阶段 2 起简谱可用，六线谱需主乐器为吉他或贝斯；默认视图取 `profile.notation`。考核题（视唱、识谱）仍固定五线谱。
- **规则引擎 v1（analysis/ruleEngine.ts）**：K-S 调性估计；按和弦标注每个音的和弦音 / 非和弦音类型（经过、辅助、倚音、逃音、未解决）；检查音域、超八度大跳、大跳后反向级进、高点次数、重复音、结尾是否主音、空和弦小节、终止式、旋律与低音的平行五八度（只作建议）。结果分 warn / info / good，措辞是建议，不评价好坏。
- **作曲台（/studio）**：钢琴卷帘（八分格，和弦行与旋律同屏滚动、和弦音行着色、警告音描红）、罗马数字调色板（借用 / 副属和弦阶段 4 解锁）、歌词（阶段 3 解锁）、自动伴奏（柱式 / 分解 / 扫弦、贝斯、鼓）、实时规则检查、保存为 `kind: 'song'` 作品。和声轨在阶段 2 解锁。播放用 `engine.playArrangement`，停止会销毁并重建合成器以取消已排程的音。
- **阶段 2–3 课程**：各 10 课。新课块 chord / progression / song；新微创作类型 `chords`（给旋律配和弦，带 exampleChords 提示）与 `song`（旋律 + 和弦，可带歌词），由 `checkSong` 判定（规则引擎警告数也计入）。测试保证每个创作都能完成、示例歌曲没有规则警告。
- **多轨编曲（P4）**：`Score.tracks`（键盘 / 吉他 / 贝斯 / 鼓，各自音量、声像、静音、独奏、音色）+ `Score.lead`（主旋律混音）+ `Score.sections`（前奏 / 主歌 / 预副歌 / 副歌 / 桥段 / 尾奏，能量 1–3、移调、休息的乐器）。`auto` 轨按和弦、段落能量和织体生成；`manual` 轨保存自己的音符（鼓用 GM 键 36/38/42/46/49）。风格模板：流行、摇滚、朋克、轻 R&B。旧作品没有 tracks 时由 `accompaniment` 推导。编曲页在阶段 5 解锁。
- **和弦色彩（P4）**：和弦槽可带 `quality`（七和弦、sus、add9、强力和弦等）和 `bass`（转位 / 斜线和弦），伴奏按实际色彩演奏；借用 / 副属和弦在阶段 4 解锁。♭ 级数的根音一律拼成降号（`spellChordRoot`）。
- **导出（P4）**：MIDI（format 1，每轨一条，鼓在第 10 通道）、MusicXML 4.0（主旋律 + 和弦名 + 歌词，另加贝斯声部）、WAV（Tone.Offline 用同一套乐器离线渲染，限幅器防削波）。全部在浏览器里生成。
- **音色（P4）**：合成音色按乐器区分（钢琴、FM 电钢琴、风琴、拨弦吉他干净 / 失真、指弹 / 合成贝斯）；**钢琴是随站打包的 Salamander 采样**（`public/audio/piano/`，C1–A6 每小三度 24 个 mp3，约 1.8 MB，CC-BY 3.0，设置页注明出处），首次出声后后台加载，加载前用 FM 合成钢琴兜底，PWA 预缓存、离线可用。加载时把每个采样的峰值归一（±6 dB 内）。
- **训练音色（0.10.0）**：`profile.trainingTimbre`（默认 `piano`，可选 `instrument` 跟随主乐器），作用于训练营、入门测试、课程试听。吉他工坊各页、谱子详情页用 `useTimbreOverride('guitar')` 临时切换，离开即恢复（`overrideTimbre` 栈）。训练用采样 release 0.6 s，编曲用 1.2 s；和弦各音错开 ≤10 ms。**音高比较题**（事件带 `detuneCents`）两音用**同一个采样**变调播放（`sameSamplePlan`），保证音分差精确。
- **防吞音（0.10.0）**：蓝牙 / USB 耳机静音几秒后会休眠，唤醒时吞掉第一个音。`ensureAudio` 启动约 -80 dBFS 的粉噪保活（标签页隐藏时暂停），且距上次出声超过 2.5 s 时序列提前量加到 0.35 s（`sequenceLead`）。
- **吉他调弦与变调夹（P4）**：标准、Drop D、全弦降半音，变调夹 0–7 品。指板与六线谱用加了变调夹的弦音；和弦图给出实际要按的指型（“按 G 型”）；调音器按空弦音。
- **阶段 4–5 课程（P4）**：阶段 4「进阶和声」10 课（♭VII、♭VI–♭VII、小 iv、V/V、V/vi、七和弦、sus/add9、斜线和弦、转调、阶段创作）；阶段 5「编曲」12 课（角色、鼓、贝斯底鼓锁定、节奏吉他、riff 与过门、键盘织体、音域频段、能量曲线、乐器进出、风格分析、混音概念、完整编曲）。新微创作类型 `arrange`（作曲 + 编曲两页），检查项见 `SongCheck`（借用、副属、色彩、斜线、移调、声部数、段落、副歌更满、锁定、音域、手写轨、休息、声像等）。测试保证每个创作都能完成，且原样不改无法通过。
- **升降级**：当前级别最近 10 题正确率 ≥85% 升级；≥6 题且 <50% 降级（`services/masteryMath.ts`）。
- **技能 id**：`interval:M3`、`degree:b7`、`chord:inv:1`、`rhythm:fig:dotted` 等，是细粒度掌握度的键。出题器 60% 概率偏向弱项。
- **混淆矩阵**：`confusions` 表，键 `module|expected|given`。
- **入门测试**：8 段自适应阶梯（音高、跟拍、识谱、音程、和弦、级数、乐理、音准；音准段需要麦克风，可跳过）（连对 2 升级、连错 2 结束），观测权重 0.35；输出起步阶段与各模块起始级别。
- **节奏判分**：按键时间取 AudioContext 时钟，减去 `outputLatency + baseLatency` 与设置页标定的设备延迟。
- **段位**：练习室 → 地下 Livehouse → 校园舞台 → 音乐节副舞台 → 录音室 → 巡演。
- **AI 层（P5）**：五个 prompt 家族在 `infrastructure/ai/prompts/<family>/v1.ts`（drill-generator、confusion-explainer、composition-reviewer、lesson-qa、plan-advisor），`prompts/index.ts` 是唯一注册表。学生输入的作品名、歌词、问题一律用 `untrusted()` 包裹并附安全规则。所有 AI 输出走 parse → `services/ai/validate.ts` 校验 → 使用 / 落库，校验不过就不保存，错误由 `aiErrorMessage` 转成可操作的中文提示。未配置 AI 时每个功能显示设置入口，其余功能不受影响。
- **不代写（P5）**：prompt 明令禁止；点评与课内问答再用 `looksLikeGhostwriting` 检测（连续 6 个以上音名 / 简谱数字 / 级数），命中的建议删除、回答隐藏并告知学生。
- **AI 专项练习（P5）**：AI 只提出“规格”（E6 的级数序列、E8 的半音序列），本地按学生当前级别校验（和弦必须在该级别允许范围、旋律在调内、首音为主音、尾音回主音、跳进上限），再用 `buildProgressionQuestion` / `buildDictationQuestion` 生成普通题目、本地判分。计入掌握度和复习，不影响模块升降级（`countsTowardLevel: false`）。存 `generatedExercises`（带 promptVersion、model、targetSkills）。
- **混淆解释与本周重点（P5）**：内置诀窍库 `drills/confusionTips.ts`（常见音程、和弦、级数对 + 每个模块的通用方法）始终可用，AI 解释是可选补充。本周重点默认由 `localAdvice` 本地排序（下一阶段门槛 → 最弱模块 → 到期复习 → 一周没练的音准 / 节奏），AI 版本按周存在 `advice` 表。
- **作品点评与版本（P5）**：每次保存有变化就记一个版本（`compositionVersions`，每首最多 40 个），可回放、可恢复（恢复另存为新版本）。作曲台新增“点评”页：规则引擎 + 编曲检查始终记录，AI 点评按结构 / 和声 / 旋律 / 编曲四维，存 `critiques`。发给 AI 的只有 `summarizeScore` 生成的符号化描述。
- **毕业项目（P5）**：阶段 5 全部课程完成后在 /graduation 开放。`course/graduation.ts` 纯函数检查七步：动机重复、每小节和弦 + 一次和声色彩、主副歌段落 + 2–3 分钟、4–6 个声部 + 副歌更满 + 手写一轨自己不弹的乐器 + 音域、至少一次点评、点评后保存过修改、导出过。全部通过写入 `profile.graduatedAt` 并发“毕业作品”徽章。起始骨架 56 小节 / 100 BPM 的段落。
- **PWA（P5）**：`public/manifest.webmanifest` + PNG 图标（`scripts/make-icons.mjs` 生成）。构建时插件把全部构建产物写进 Service Worker：安装时预缓存，导航网络优先、断网回退到缓存的 index.html，Google Fonts 按需缓存，public/ 下的钢琴采样随安装预缓存，AI 请求永远直连不缓存。只在生产构建注册；开发模式会注销残留的 worker。Start.bat 现在按需构建并用 `vite preview` 在 5174 提供（构建失败回退到开发服务器）。
- **吉他工坊（G1，/guitar）**：
  - **输入**：`inputManager` 是全站唯一的音频输入。消费者连到稳定的 `bus` 节点，换设备时底层流替换、无需重连。用途分 voice / instrument：唱歌永远用麦克风（`pickInputFor` 跳过吉他线），乐器用选中的设备。设备与输出选择存在 profile（audioInputId / audioOutputId）。按设备名识别吉他线（Rocksmith、Real Tone 等）。
  - **监听**：原始信号送检测，效果链只给耳朵听。十级链：噪声门（AudioWorklet）→ 压缩 → 过载 → 失真 → 音箱（干净 / 轻失真 / 高增益 + 三段均衡）→ 箱体 → 合唱 → 延迟（可跟随曲速）→ 混响（程序生成冲击响应）→ 总音量与限幅。开关用短增益过渡，不爆音。五个内置预设 + 自定义预设，课程练习可推荐预设。输入是麦克风时开监听必须确认戴耳机（防啸叫）。
  - **延迟**：显示浏览器报告的估计值（>60 ms 给出改善提示）。校准：跟 90 BPM 节拍器拨 16 下空弦，去掉 4 下热身和离群值，≥8 下且波动 ≤25 ms 才算成功，按“输入设备→输出设备”分别存在 `profile.latencyByDevice`。判定时 `judge()` 优先用校准值。
  - **起音检测**：音频线程 tap 把原始采样和帧号发回主线程；`OnsetDetector` 按 256 采样一跳，看“高频成分”（相邻采样差）相对前 4 跳的跃升，配合电平下限和不应期，时间细化到毫秒级。吉他线和麦克风各一套参数。
  - **练习**：节奏线单元 1–4（开放和弦逐弦检查、一分钟换和弦按根音计数、基础扫弦、四种节奏型）。扫弦练习台：一小节预备拍、伴奏（去掉吉他轨的鼓和贝斯）或节拍器、调速、达标自动加速、循环、扫弦谱实时高亮与逐下评级。上扫下扫方向听不出来，只判时间。进度存 Dexie v4 `guitarProgress`，计入经验值与导出。
  - **G2**：节奏线 5–8（强力和弦与闷音、横按、雷鬼 / 放克 / 切分、主歌 + 副歌整首），主音线 1–4（指板认音 / 找音、A 小调五声五个把位、四个原创句型、推弦与揉弦）。整首练习按段落换节奏型，单独统计反拍和“换和弦那一下”的子分。五声把位由“每弦两音、从低音弦的音阶音起 12 个音”算出。跟拍演奏复用 PerformPad 的窗口测量。推弦看音高曲线最高部分与目标的误差和保持时间，揉弦看去趋势后的幅度（10–90 百分位）和过零速率。
  - **和弦识别提示**：长 FFT 的频谱峰值折叠成 12 音级，与大、小、强力、属七、小七模板比余弦相似度。只显示“听起来像”，不计分；每次扫弦练习统计与谱面一致的小节数，按吉他线 / 麦克风分别存在 `profile.chordHintStats`，设备检查页显示准确率。
  - **G3**：主音线 5–8（击弦 / 勾弦 / 滑音、大调五声与大调音阶的 CAGED 把位、瞄准和弦音、跟伴奏即兴）。连奏练习在吉他线模式下统计拨弦次数，提示连奏的音是否被拨出来（只提示）。瞄准和弦音检查每小节第一拍的音是否属于当前和弦。即兴：音高轨切成音符，统计音阶内比例、强拍和弦音比例、留白、乐句数、音域，给本地建议；可转成八分格乐谱存进作品集。
  - **AI（可选）**：`guitar-coach/v1` 根据低分练习出扫弦（节奏型 id、开放和弦级数、速度）、句型（A 小调五声第一把位内）和推弦练习，本地校验后转成普通练习，存在 `generatedExercises`（module 'guitar'），在 /guitar/ai 练；小调进行转成关系大调级数以复用练习台。`improv-reviewer/v1` 根据统计和每小节音名点评即兴，过“不代写”过滤。
  - **接入**：吉他工坊不进每日训练（PLAN_VERSION 4 起，用户决定自选）；`afterGuitarAttempt` 只会勾掉旧计划里残留的吉他项；技能地图显示两条线的单元进度；新徽章“第一次过关”“节奏吉他手”“主音吉他手”。
- **曲库与导入（0.9.0，/songs）**：内置曲目只收公有领域作品（民歌、古典主题、1900 年前的歌曲）和本站原创练习曲，**不内置受版权保护的歌曲**；用户自己的谱子通过导入进来，只存本机（Dexie v5 `songSheets`）。导入支持 MIDI（选旋律音轨，取最高音成单声部，十六分量化，每小节按所有音估一个和弦）、MusicXML / .mxl（选声部，声部 1，连音线合并，读和弦标记、歌词、调号、速度）、文本和弦谱（`| C | G |` 或 `[C]歌词`，自动猜调）、ASCII 六线谱（按间距估节奏，读 h / p / b / / / ~）。和弦名映射成“级数 + 色彩覆盖”，根音不在可用级数里的和弦空着并提示。非 4/4 拍按 4/4 重新分小节、跨小节的音截断，都会提示。每首可看谱、播放、练扫弦（小调转成关系大调级数）、弹旋律（移八度到吉他音域，按把位指法），或复制到作曲台。作曲台也能直接导入 MIDI / MusicXML。
- 开发服务器与预览服务器都固定端口 **5174**（IndexedDB 按 origin 隔离）。

## 5. 分期

| 期 | 内容 | 状态 |
| --- | --- | --- |
| P1 | 骨架、音频引擎、虚拟键盘、节奏谱、E1–E5、R1–R3、延迟标定、掌握度、每日训练、入门测试、趣味机制 | 已完成（0.1.0） |
| P2 | 麦克风音准（音域标定 + S1–S7）、E6–E9、识谱 N1 与乐理 T1、间隔重复、吉他 / 贝斯指板与和弦图、调音器、乐器任务 I1/I2、阶段 0–1 共 18 课、微创作与作品集、入门测试 8 段 | 已完成（0.2.0） |
| P3 | 统一乐谱模型、简谱 / 六线谱 / 四线谱视图、规则引擎 v1、作曲工作台（旋律 + 和声 + 歌词 + 自动伴奏）、阶段 2–3 共 20 课、歌曲进作品集 | 已完成（0.3.0） |
| P4 | 多轨编曲（段落、能量、风格模板、手写轨、混音）、和弦色彩 / 借用 / 副属 / 转调、MIDI / MusicXML / WAV 导出、乐器音色与采样钢琴、吉他调弦与变调夹、阶段 4–5 共 22 课 | 已完成（0.4.0） |
| P5 | 五个 AI prompt 家族与本地校验、AI 专项练习、混淆解释、本周重点、作品点评与版本历史、课内问答、毕业项目、PWA 安装与离线、数据导入、无障碍补充 | 已完成（0.5.0） |

## 6. 已知边界

- 除钢琴外都是合成音色。
- **歌曲库（0.18.0，/library，Dexie v11 `libraryFolders` / `librarySongs`）**：
  - 用户自己选文件夹（`showDirectoryPicker`，只读；Chrome / Edge），目录句柄存 IndexedDB，浏览器重开后要点「允许访问」（`requestPermission` 必须由点击触发）。**只列出、不复制、不上传**；用到哪首才读那个文件。网站不提供任何下载功能（用户要求逆向第三方音乐下载站，已拒绝；歌曲库指向下载文件夹即可）。
  - 扫描（`LibraryService.scan`）：最多 6 层、5000 个文件，按 路径 + 大小 + 修改时间 增量；新 / 改过的文件读头尾各 512 KB 解析标签（`audio/library/tags.ts`：ID3v2.2–2.4、ID3v1、FLAC / Ogg Vorbis comment、MP4 ilst）；文件消失则删行；**用户改过的名字（source 'manual'）不会被覆盖**。页面打开时每 8 秒静默扫描一次（只扫已允许的文件夹），有新歌弹提示。
  - 歌名（`songs/libraryNames.ts`，纯函数）：标签优先；乱码修复（Latin-1 误读的 UTF-8 / GBK / Big5，必须能干净解码且出现汉字才采用；ID3 编码 0 与 ID3v1 先按 GBK 试）；文件名清理（扩展名、开头序号、[无损] / 320k / mqms2 / 咪咕 等标记、长 id、下划线）；「A - B」拆歌手和歌名：全库投票（标签和手改的名字 +3，每个「a - b」文件名 a +1、b −1），**同一对名字（任一顺序）的文件不互相投票**——顺序互相矛盾时按常见的「歌手 - 歌名」并标「待整理」；歌手一侧的「(Live)」移到歌名；子文件夹名是已知歌手时作为歌手。认不出的标「待整理」。
  - 页面：按演唱者分组、同名不同文件作为版本下拉；搜索、待整理筛选、试听、改名（对话框）、批量设演唱者、「写回文件名」（`FileSystemHandle.move`，先 confirm、再要写权限，改成「歌手 - 歌名.ext」）、「跟唱」→ `/sing`（`location.state.librarySongId`）自动带歌名 / 歌手并打开「只分人声」的分轨对话框。`LibraryPicker` 对话框供跟唱导入与「原曲伴奏」使用（原曲伴奏可选「自动分轨后使用」或「直接用作原曲」）。
  - 人声模型缺失（git 克隆后没跑转换脚本）时，`vocalsModelPresent()`（HEAD，排除 SPA 回退的 text/html）为假，跟唱分轨自动改用六轨模型。
  - UVR 模型仓库（`TRvlvr/model_repo`）没有声明许可证：**公开的 GitHub Release 不附模型**，带模型的压缩包只在本地 `release/` 给用户私下转发。
- **后期引擎与后期课堂（0.20.0 / 0.21.0）**：
  - `MixSettings`（`songs/singTypes.ts`）0.21 新增：人声 `gate / dynEq / comp2 / parallel / saturation / mod / order / autoLevel / tune`，`deEss.thresholdDb`，混响 `type / lowCut / highCut`，延迟 `pingPong / highCut`；伴奏 `duck / pocket / stems`；母线 `ceilingDb / multiband / width / targetLufs`。全部必填，旧存档由 `clampMix` 补中性默认值（`fixOrder` 修正顺序）。预设新增 ballad / folk / rap / rnb / lofi / ktv。
  - `audio/sing/mixChain.ts`：插入效果按 `order` 串联（顺序变化 → `structureKey` 变 → MixPlayer 重建图并在原位置继续播放）；混响 / 延迟是发送；伴奏每轨一个 `stemGains`；母线 多段（两级二阶滤波分频 + 三台压缩）→ M/S 宽度 → 限幅 → K 加权近似分析器（实时 LUFS）与左右分析器（相关性）。`audio/fx/mixWorklet.ts` 自写 'groove-dyn' AudioWorklet（comp / gate / split 三种模式，可外部侧链）负责噪声门、动态 EQ、动态去齿音、伴奏让位；离线用原生构造，实时用 Tone 的工厂；加载失败时去齿音退回静态切，其它直通。
  - 离线导出（`renderMix`）：`audio/fx/limiter.ts` 真峰值砖墙限幅（±lookahead 最小值 + 同窗平均 + 慢释放，4× 真峰值复核）；`targetLufs` 时先归一化再限幅，两遍。`audio/fx/loudness.ts`：BS.1770-4 / EBU R128（任意采样率 K 加权、门限、短时 / 瞬时、LRA、4× 真峰值、音量对齐增益）。
  - 人声预处理（链路之前，离线、按设置缓存）：`audio/fx/voicePrep.ts` = `autoLevel.ts`（每句响度取最响 70% 的 50 ms 窗，按力度拉向中位数 + 逐句偏移，40 ms 斜坡）+ `pitchCorrect.ts`（YIN 音高、约 250 ms 中位数定音中心保留颤音、按速度平滑、TD-PSOLA 重合成、±100 音分封顶）。
  - `audio/fx/mixAdvisor.ts`：本地测量（电平、六段能量占比、动态范围、底噪与哼声、削波、1–5 kHz 遮蔽、齿音频点）→ 规则建议（只在当前设置没处理时出现，`apply` 返回新对象）。可选 AI 点评 `mix-reviewer/v1`（`services/mixAIService.ts`，只给文字建议、校验 module 白名单）。
  - MP3 导出：`@breezystack/lamejs` 1.2.7（lamejs 的 ESM 分支，LGPL-3.0），`export/mp3.ts`。
  - **后期课堂**（`/mixing`、`/mixing/:lessonId`、`/mixing/ear`）：`mixing/types.ts`（课程数据结构）、`mixing/controls.ts`（所有可调参数的路径 / 标签 / 范围注册表）、`mixing/lessons.ts`（7 单元 46 课，38 个动手任务，40 个 A/B 示范；`tests/mixingLessons.test.ts` 校验路径与范围）、`mixing/base.ts`（中性起点 + patch 合并）、`mixing/material.ts`（自生成素材：96 BPM 8 小节鼓 / 贝斯 / Salamander 钢琴、合成示范人声、学生 20 秒录音（统一到 −24 LUFS）；可加入问题 hum / hiss / sibilance / boomy / harsh / dull / uneven / quiet / clipping / muddyBacking；乐器素材走人声通道）、`mixing/checks.ts`（参数条件 + 渲染后测量：LUFS、真峰值、增益衰减、低频减少、齿音减少、句间差）、`mixing/drills.ts`（十种听辨各四级，`nextLevel`：最近 5 题对 4 升、错 3 降）。A/B 示范与听辨都离线渲染片段并按 LUFS 对齐（`widgets/mixing/excerpts.ts`）。Dexie **v12**：`mixCourse`（自己的声音）、`mixProgress`、`earStats`、`userMixPresets`。听辨不进每日训练。
  - 跟唱后期：`widgets/mix/DeskExtras.tsx`（效果顺序、通用面板控件、逐句微调、音高修正设置、分轨音量、目标响度、实时频谱与响度 / 相关性、智能建议、我的预设、快照 `SingMeta.mixSnapshots`、每个面板的后期课堂链接）。
- **跟唱重新开始 / 草稿（0.21.6）**：`SingTake.archive`（草稿 id）——有它的录音不显示、不参与按时间裁剪；`SingMeta.drafts`（名称、时间、录音数、句数、平均最好）。`SingService.saveDraft / clearTakes(key, ids?) / restoreDraft（先把当前录音自动存成草稿）/ deleteDraft`，都会清空完整版逐句选择；会话 `resetToken` 让 PracticeTab 忘掉已评分状态。UI `widgets/sing/RestartDialog.tsx`，报告区「清除这一句的记录」。未改 Dexie 结构。
- **整首重唱 + 按原唱对齐（0.21.7）**：`widgets/sing/FullRun.tsx`（`RunBanner` / `RunReportCard`）+ PracticeTab 的整首模式：倒数 3 s → 从 0 播放；暂停 / 继续用 `cutRecording` 分段，结束时 `assembleVoice` 拼成一条 phrase −1 录音写入并设 `comp.mode = 'full'`；本遍成绩 = 每句 `createdAt >= startedAt` 的最新一次。音高修正 `tune.scale = 'reference'`：`voicePrep.referenceTarget(notes, gaps)`（±150 ms、折到演唱者八度）作为 `correctPitch` 的 `target`，`tune.range` 为 `maxShift`，`TuneStats` 经 `prepStats` 显示。未改 Dexie 结构。
- **旧谱名字修复与监听单声道（0.21.5）**：`SongService.repairTexts` 在 WrittenSheet 拿到 score 后比对，存储的音轨名 / 标题 / 演唱者有乱码（`garbleScore`）或广告时用正确读出的值覆盖。`VoiceMonitor` 先经一个 1 声道（explicit, speakers）增益节点把 L+R 折成单声道（+6 dB 补偿单边输入），输出节点 2 声道，左右都有声音。
- **和弦图位置（0.21.4）**：AlphaTabView 在 `scoreLoaded` 里改 `score.stylesheet`（`globalDisplayChordDiagramsInScore` / `globalDisplayChordDiagramsOnTop`，`perTrackChordDiagramsOnTop = null`），默认"跟着谱面"，localStorage `groovelab:sheet-diagrams`；同时对谱头文字做 `stripSiteAds`。
- **跟唱监听与多遍修复（0.21.3）**：`audio/sing/voiceMonitor.ts`（inputManager.bus → 90 Hz 低切 → 干声 + 短板式混响 → 输出；设置存 localStorage `groovelab:sing-monitor`，只在麦克风开着时运行）。`latestPass`：一句唱多遍时样本按到达顺序追加，时间回跳即新一遍；`finishPhrase` 只保存 / 评分最后一遍，PracticeTab 显示旧录音也只取最后一遍；PitchLane 只连接向后、间隔 < 120 ms、音高差 < 3 半音的点。导入 GP 时 `stripSiteAds` 去掉标题 / 歌手 / 制谱里的网址与广告语。
- **GP 文字编码与谱面显示（0.21.2）**：`audio/alphatabEncoding.ts` `loadScoreDecoded` 先用 UTF-8 读，文字里有 U+FFFD 或（无汉字时的）Latin-1 高位字符就改用 GBK、Big5 再读，取最干净的；导入（songService）、歌词（gpLyrics）和看谱（AlphaTabView 的 `importer.encoding`）都用它。AlphaTabView「显示」面板按名字设置 `notation.elements`（创建时放进选项，之后用 `settings.fillFromJson`；**不要用数字键直接改 Map**——传给排版 worker 后会让渲染卡死），存 localStorage `groovelab:sheet-display`；默认隐藏 EffectText 和 LetRing / PalmMute。
- **强制停止分轨（0.21.1）**：`SeparateDialog` 的「强制停止」= AbortController.abort()；`separate.ts` 在解码后、每次重试前、每个 worker Promise 建立时都检查 `signal`，Promise 的 finally 终止所有 worker；30 秒无进展显示"可能卡住"；分轨中关闭对话框先确认。本机助手新增 `POST /jobs/<id>/cancel`（排队中立即取消；运行中在两次模型计算之间停止并删除临时目录，状态 `cancelled`）。
- **浏览器分轨崩溃降级（0.20.0）**：worker 无消息的 error 视为崩溃（多为内存或显卡丢失）：GPU → 处理器全部路数 → 2 路 → 1 路，依次重试；最后给出可操作的说明。
- **管理员模式（0.17.0，`services/adminMode.ts`）**：昵称为 `admin`（忽略大小写和首尾空格）时，`effectiveProfile` 把 `unlockedStage` 视为最高阶段——profileStore 给页面的是这个视图，`CourseService.status`、`GraduationService.unlocked`、`ModuleProgressService.setLevel`、ModulePage 的级别按钮都按它判断。**数据库里的进度不改**（ProfileService.update 读的是库里的行），改回别的昵称即恢复。侧边栏显示「管理员模式」，设置页多一个「管理员」区（分轨耗时、只用处理器的测试开关）。只是本地方便开关，不是安全边界。
- **跟唱分句与回听（0.16.2）**：
  - 分句来源（`songs/phrasing.ts`，`useSingSession.phraseSource`）：手动 `SingMeta.phraseCuts`（并入上一句 / 在最长停顿处拆开 / 恢复自动）> 时间可信的歌词 `SingMeta.lyricsTimed`（每行一句，收紧到行内实际有声的范围）> `autoPhrases`（300 ms 内换气不切，<550 ms 停顿且合并后 ≤8 s 的连起来，<1.5 s 的碎片并到近邻）。旧的 `phrasesOf` 保留（测试用），会话不再使用。
  - 粘贴的纯文本歌词先 `alignLyrics`（动态规划：按 ≥120 ms 的停顿把原唱切成小段，每行分到的音符数 ≈ 字数 × 全曲音符/字数比，换行偏好长停顿、行内长静音和过长的行加罚，前奏 / 和声小段可跳过）→ 显示「自动对齐结果」，**用户确认后**才写入并 `lyricsTimed = true`。LRC 导入、谱子歌词、打拍对齐直接视为可信。旧版按停顿平均分配的歌词没有该标记，歌词页提示「自动对齐歌词」。
  - 录音按时间归属乐句：新录音带 `fromMs` / `toMs` / `speed`；旧录音按 `sungMs` 范围。`groupTakes` 按重叠最多归到当前乐句，`takeFitsPhrase`（重叠/并集 ≥0.75）不满足的标「按旧分句唱的」、不计入最好成绩；`saveTake` 按 `sameStretch`（时间重叠）而不是句号裁剪。改分句（`resegment`）会清空完整版的逐句选择。
  - 回听是独立状态：练习时钟停止跟随 / 打分 / 循环，麦克风采样与 SongClock 打点暂停（`session.previewing`），锁定当前句和录音；录音先预解码，伴奏 `seekReady` 后播放并等 `whenRunning`，再按伴奏实际位置把录音排到 AudioContext 的精确时刻（按录音时的速度）；结束后恢复混音、速度和原来的位置（暂停）。点乐句列表只选中 + 定位，不自动播放；播放中跳句时在引入段内锁定所选句。
- **变调（0.16.1）**：「我的谱子」详情页与简单谱子 / 曲库曲目都有变调（−6…+6，按谱子保存 `transpose` / `transposeWay`；`songs/transpose.ts`）。GP 谱：alphaTab 的 `notation.transpositionPitches` + 直接改各 staff 的 `transpositionPitch`（它只在加载时读设置），再 render + `loadMidiForScore`，五线谱和播放变调、六线谱品位不变、鼓轨不动。吉他弹法二选一：升调默认「按原指法夹变调夹 N 品」（检测练习按 谱子变调夹 + N 校验，可一键切到对应变调夹），或「品位整体移动」（落到 0 品以下 / 22 品以上的音移一个八度）。扫弦练习的和弦随新调。原曲音频不能变调，变调时自动关掉「同时放原曲」并说明。
- **worklet 节点必须用 `createWorkletNode`（`audio/guitar/worklets.ts`）**：Tone 的 rawContext 是 standardized-audio-context 包装，原生 `new AudioWorkletNode(ctx)` 会报 “parameter 1 is not of type BaseAudioContext”（0.16.1 修复：跟唱录音、起音检测、噪声门）。
- **跟唱 2.0（0.16.0）**：跟唱页四个页签（跟唱 / 歌词 / 完整版 / 后期），共享 `features/sing/useSingSession`（SingSessionContext）。来源键 `song:<id>` / `sheet:<id>`（`singKey`），「我的谱子」的谱子走同一套。
  - **评分 2.0**（`songs/singAlong.ts`，SCORE_VERSION 2）：`notesOf` 把原唱按 ~140 ms 中值滤波后切成稳定音符（±60 音分内、≥120 ms；滑音 / 转音 / 装饰音是过渡不打分）；学生同样平滑；`findLag` 每句在 ±300 ms 里找最吻合的时间差；八度按音符时长投票；每个音取窗内中位音高，≤25 音分满分、≥100 音分 0 分线性渐变，唱到 ≥40% 时长才算唱到；句分 = 按时长加权平均。`isScorable`：≥2 个音或 1 个 ≥0.6 s 的长音。连续 3 句同向偏差 ≥120 ms → 提示校准延迟（`steadyLag`）。建议具体到第几个音（`feedbackFrom`）。旧最好成绩随 v10 清空。
  - **Take**：每唱完一句存一次（`SingService.saveTake`）：音高样本、TakeScore（含每音偏差）、录音（`audio/sing/voiceRecorder`：groove-tap 取麦克风原始样本 + `SongClock` 记录 (ctx 时间, 歌曲 ms) 对，按歌曲时间切片，去掉往返延迟，48 kHz 降到 24 kHz 存 WAV）。库里每句只留最好 / 最近 / 保留的；整首 take（phrase −1）留最近 3 个。会话内每句保留最近 5 次。回放：只听自己 / 和伴奏（伴奏去掉导唱）/ 和原唱对比；每个 take 可保留、±10 ms 对齐。
  - **歌词**（`songs/lyrics.ts`、`widgets/sing/LyricsTab` / `LyricsDisplay`、`import/gpLyrics.ts`）：LRC（多时间标签、[offset]、逐字增强格式）导入导出，粘贴纯文本按乐句分配（去掉段落名），合并 / 拆开 / 挪文字 / 微调 / 设为当前位置 / 打拍对齐；谱子可读 GP 歌词（音节按谱面时间经原曲伴奏同步映射到录音时间）。**不做自动识别、不联网找歌词**（版权；用户明确不要自动识别）。存 `singMeta.lyrics`，进数据导出。
  - **完整版**（`widgets/sing/FullVersionTab`、`songs/compAssembly.ts`）：拼最好的几句（每句选 take / 原唱补位 / 留空，按测到的时间差对齐到原唱，可整体和逐句微调，30 ms 淡入淡出）或一口气唱完（可暂停接着录，按段切片再拼）。合成的人声交给后期。
  - **后期**（`audio/sing/mixChain.ts` + `widgets/mix/*`）：同一个 Web Audio 链用于预览和离线渲染：低切 → 4 段 EQ（缺段用中性峰值滤波，避免 BiquadFilter 默认低通）→ 压缩 + 补偿 → 简化齿音消除（静态窄带衰减）→ 人声增益 / 声像 → 混响（代码生成的脉冲响应）/ 延迟（可按速度同步）发送；伴奏 3 段 EQ + 增益；母线增益 + 限制器。预设 6 个（`songs/mixPresets.ts`，都是 4 段），EQ 曲线按 Web Audio 公式绘制可拖动，电平表 + 增益衰减，每个模块「这是什么」教学卡 +「听听看」开关对比，5 步引导，「练练耳朵」（低切 / 压缩，答对 +5 XP）。导出 WAV（完整版 / 只人声 / 只伴奏），保存到作品集「翻唱」（Dexie `covers`，音频不进导出，页面提示仅供个人练习）。伴奏优先用分离的乐器轨，其次伴奏轨，只有原曲时提示会混入原唱。
- **自动分轨（0.15.0，D-3）**：原曲伴奏面板与跟唱导入里的「自动分轨」（`widgets/separation/SeparateDialog` → `audio/separation/separate.ts`），两个引擎，结果都是 `<歌名>_(Stem).wav`，交给 `detectStem`：
  - **本机助手**（优先，探测 `http://127.0.0.1:5175/health`）：`helper/server.py`（Python 标准库 HTTP + audio-separator 0.47，MIT，UVR 后端），先 BS-RoFormer（`model_bs_roformer_ep_317_sdr_12.9755.ckpt`）分人声 / 伴奏，再 htdemucs_6s 把伴奏分成鼓 / 贝斯 / 吉他 / 钢琴 / 其它（链式输出名取**最后一个**括号）。只监听 127.0.0.1，CORS 只放行 localhost:5174 / 127.0.0.1:5174（其它来源 403），带 Private-Network 头；作业在 `helper/jobs`（保留最近 4 个）。`helper/install.bat` 一次性安装（py 装 Python 3.12 → `helper/.venv` → `audio-separator[gpu]` → CUDA 版 torch（cu128）→ audioread、setuptools<82）；`Start.bat` 检测到已安装时自动最小化启动 `helper/start.bat`。.venv / models / jobs 已 gitignore。本机实测 RTX 4080 SUPER：12 s 音频 7 轨约 10 s（模型已加载）。
  - **浏览器**：`demucs.worker.ts` 在 Worker 里动态加载 `public/ort/` 的 onnxruntime-web 1.30（WebGPU 版，asyncify wasm；`scripts/copy-ort.mjs` 复制，**不进 PWA 预缓存**），模型 `kramp/htdemucs-6s-webgpu-onnx`（MIT，285 MB，从 huggingface.co 下载，Cache Storage 尽力缓存——存不下也照常分轨）。输入 [1,2,343980]（44.1 kHz 7.8 s），输出 [1,6,2,343980]（drums/bass/other/vocals/guitar/piano）；`chunks.ts` 12.5% 重叠（0.17.0 起，原 25%）线性交叉淡化、首尾不淡化。无 WebGPU 时退回 WASM（单线程，很慢）。
  - **浏览器 · 只分人声（0.17.0，跟唱用 `mode: 'vocals'`）**：UVR-MDX-NET-Voc_FT（UVR 官方模型仓库 `TRvlvr/model_repo`），`scripts/make-vocal-model.py`（用 helper 的 Python 环境）转成 float16 计算、float32 输入输出 → `public/models/vocals-mdx-fp16.onnx`（33 MB，**gitignore，随发布压缩包带上**，不进 PWA 预缓存）。与 fp32 输出相差 −68 dB。信号处理在 `mdx.ts`（与 UVR / audio-separator 一致：7680 点 STFT、hop 1024、周期 Hann、反射填充、前 3072 个频点、[B,4,3072,256] = L 实/虚、R 实/虚；分块 261 120 采样、TRIM 3840、Hann 混合、×1.021），`fft.ts` 自写混合基 FFT（4/2/3/5 + 通用；L+iR 合并做一次复数 FFT）。与 PyTorch STFT 逐值一致；与 Python 参考实现（25% 重叠、fp32）相比 35.7 dB。伴奏 = 原曲 − 人声。
  - **调度**（`separate.ts` 的 `runMdx`）：WebGPU 且支持 `shader-f16` → 1 个 worker、每批 2 块、worker 内在 GPU 计算时准备下一批；否则 CPU：`cpuWorkers()` = ⌊核心数/3⌋（1–6）个**单线程** worker 并行处理不同块（onnxruntime 的多线程 WASM 在 worker 里起线程会死锁、在页面主线程会卡死界面，所以不用；也因此**不需要**跨源隔离头）。GPU 会话建不起来时自动改走 CPU。本机实测（RTX 4080 SUPER）：30 s 歌曲 GPU 2.7 s；CPU 6 路约 55 s（短歌被收尾拖慢，4 分钟歌约 3 分钟）。
  - 进度显示用的方式与预计剩余时间；耗时记在 localStorage `groovelab:separation-timings`（`timings.ts`，最近 20 次），管理员页可看；localStorage `groovelab:separation-cpu = 1` 强制只用处理器（管理员页开关）。
- **跟唱（0.14.0，D-2，/sing）**：侧边栏「跟唱」。歌曲需要一条**人声轨**（UVR 分出的 vocals），可加伴奏 / 原曲；存 Dexie v9 `singSongs`，音频在 `audioFiles`（sheetId = 歌曲 id），不进导出。「我的谱子」里原曲伴奏带人声轨的谱子也会出现（`/sing/sheet/:id`，原曲伴奏选「练唱」时有链接）。
  - 原唱音高（`songs/singAlong.ts` + `audio/backing/pitchCurve.ts`）：人声轨按 16 kHz 单声道解码，每 20 ms 一帧 YIN（窗 40 ms，静音帧跳过，分块让出主线程），去掉 <80 ms 的碎片、八度跳变折回、5 帧中值平滑；按 CURVE_VERSION 缓存在 `pitchCurves`。停顿 ≥300 ms 切乐句，<0.6 s 的碎片丢弃。
  - 跟唱页：StemPlayer 放伴奏，人声轨作「导唱」音量可调（0 = 只有自己）；速度 75/90/100%（不变调）；按句跳转（提前 1.5 s）和循环。麦克风帧换算成录音时间（帧龄 + 设置里的往返延迟 × 速度）。Canvas 音高带：灰色原唱、彩色自己（±50 音分内为绿），播放头在 30%。
  - 评分（`scorePhrase`）：每句一个八度移位（任何八度都算），每个演唱样本在 ±100 ms 内找最接近的原唱值；命中率（±50 音分）、平均偏差、偏高偏低倾向、唱到的比例；得分 = 命中率 × min(1, 覆盖/0.8)。措辞是“估计”，不评判嗓音。歌曲按句保存最好成绩。
- **原曲伴奏（0.13.0，D-1）**：谱子详情页（有原文件的 GP / MusicXML）下方的 `widgets/sheets/BackingPanel`。学生附上原曲音频：完整音频，或 UVR / Demucs 分好的几轨（`detectStem` 按文件名认 vocals / instrumental(no_vocals) / drums / bass / guitar / piano / other，中英文）。音频以 Blob 存 Dexie v8 `audioFiles`（按 sheetId 索引，**不进数据导出**，清空数据和删谱子时删除），保存前用 `navigator.storage.estimate` 查剩余空间。
  - **时钟**：alphaTab 仍是主时钟（变速、循环、预备拍照常）；`audio/backing/stemPlayer.ts` 用 <audio> 元素（preservesPitch 变速不变调、setSinkId 走设置里的输出设备）跟随 `playerPositionChanged` 的 tick，偏差 >70 ms 重新定位；正在启动的元素不再重复 seek / play（否则会互相打断）；静音用音量 0（Chrome 会暂停 muted 的离屏元素）。
  - **对齐**（`songs/backingSync.ts`，纯函数）：`barTimeline` 按谱面速度（含小节内变速）算每小节的谱面时间；`SyncMap` = 偏移 + 打拍同步点，点之间线性插值、两端按相邻段比例外推。首次导入时自动对齐开头（`firstSoundMs`：鼓轨 / 原曲的第一个起音 − 谱面第一个音）；可整体提前 / 推后，或「打拍对齐」：从所选小节前两小节开始单放原曲，每小节第一拍按空格（减去输出延迟），最多 8 个点。
  - **练习角色**（`roleMix`）：全部原声 / 练主音 / 练节奏吉他 / 练贝斯 / 练鼓 / 练唱，静音对应分轨；只有完整音频（或只有人声 + 伴奏两轨）时只能去掉人声，界面提示。分轨模型分不开主音和节奏吉他，所以练吉他时去掉整条吉他轨，可勾选谱子的其它音轨由合成音补上（`fillTracks`，默认勾上其它吉他音轨）。原曲开启时 alphaTab 的其它音轨静音、隐藏其自带混音和“跟伴奏弹”。
- **课后实操（0.12.0）**：每节课内容块之后、课程问答之前的「课后实操」（`widgets/lesson/HandsOnSection`，`id="handson"`）。步骤由 `course/handsOn.ts` 从课的内容块**自动推导**（和弦 → chord、和声进行 → progression、音阶 / 指板音 → play、旋律 / 歌曲开头两小节 → sing、节奏 → rhythm），每种最多一个，优先保证有唱，最多 3 步；`EXTRA` 给个别课手工补步骤（L1-4 自然小调、L1-8 大小三度）。纯编曲 / 混音概念课和阶段创作课可能没有实操（不显示）。
  - 出题：`stepQuestion(step, {instrument, vocalRange})` 生成现有的 perform 题（I1 乐器 / S3 人声，按乐器音域或学生音域整八度移位，八度等价）或 rhythm_read 题，用 `gradeQuestion` 本地判分（答对或得分 ≥ 70% 算通过），不写训练记录。吉他学生的和弦步骤用吉他工坊的 ChordCheck（找不到指法时退回分解和弦题）、和声进行用 StrumPractice（四分下扫，小调进行转关系大调）。没乐器的学生把弹改成唱。
  - **不卡课程完成**（用户决定，方案 B）：结果存 `LessonProgress.handsOn[stepId]`（passed 不会被之后的跳过 / 失败覆盖，保留最好分数）；跳过或没通过的出现在训练营的「待补的实操」（`CourseService.pendingHandsOn`），链接到 `/course/<id>#handson`。
- **我的谱子（0.11.0，/sheets）**：只放用户导入的谱子；/songs 只剩内置曲目（旧链接 /songs/sheet/:id 重定向）。
  - **alphaTab 1.8.4**（MPL-2.0）读 Guitar Pro 3–8 / MusicXML、渲染五线谱 + 六线谱、播放。**不打包进主代码**：`scripts/copy-alphatab.mjs` 把独立脚本、Bravura 字体（OFL）、Sonivox 音色库（Apache-2.0）复制到 `public/alphatab/`，`audio/alphatabLoader.ts` 在打开谱子时插 <script> 加载（这样它能从同一文件启动渲染 / 合成 worker；ESM + Vite 打包会坏）。代码里只 `import type`。升级 alphaTab 后必须重跑复制脚本（有测试比对 VERSION.txt）。
  - 导入：`import/gpImport.ts`（纯函数，注入 alphaTab Score）读元数据（歌名、演唱者、制谱、速度、段落、音轨：乐器 / 调弦 / 变调夹）、`trackToTab`（一条音轨 + 小节范围 → 单声部 TabNote：和弦取最高音、连音线与休止并入前一个音、推弦 / 揉弦 / 击勾弦 / 滑音保留；alphaTab 弦号 1 = 最低弦，TabNote 0 = 最低弦）、`trackChordChart`（谱里写的和弦名 → 文本和弦谱 → 现有和弦谱导入器 → 扫弦）。原文件以 base64 存 Dexie v7 `sheetFiles`（随数据导出），删谱子时一并删除。MusicXML 也保留原文件，用 alphaTab 显示。
  - 组织（`songs/sheetGroups.ts`）：按演唱者分组（大小写 / 空格 / 标点不敏感，未填写的排最后），同一演唱者的同名谱子合成一首歌，卡片和详情页用**下拉框选版本**（`versionLabel`：用户版本名，否则 格式 · 制谱 · 导入日期；默认最近打开的）。搜索歌名 / 演唱者 / 版本名 / 标签，按最近练习 / 名称 / 导入时间排序。
  - 详情页：音轨、谱面（五线 + 六线 / 只六线 / 只五线）、练习段落（显示段落名）；播放（光标跟随、25%–125% 变速、循环所选小节、预备拍、节拍器、每轨静音 / 独奏、“跟伴奏弹”= 静音当前音轨），颜色跟随主题（换明暗重建）。检测练习（`GpPractice`）：所选段落送 LeadPlay（≤48 个音）或 StrumPractice；只支持六弦吉他音轨；调弦与吉他设置不同时提示，能匹配已知调弦（`songs/tuningMatch.ts`）时一键切换。每段最好成绩存 `sectionBests`。alphaTab 播放走自己的 AudioContext（默认输出设备、无延迟校准）。
- **未完成训练（0.10.0）**：Dexie v6 `activeRuns`（`RunService`）。DrillRunner 传 `run` 后每题保存快照（题目、作答、结果、统计、固定题单），回来时显示“上次还没做完 · 继续 / 重新开始”，答过的题按原样显示结果；题单固定（AI 练习按 `ai-<exercise id>` 标记已用）。键：`module:<id>`、`plan:<item id>`（当天作废）、`lesson:<课>:<块>`、`ai`、`placement`、`guitar:<练习 id>`（仅音名 / 找音两种多题练习）。计时挑战、录音类单次演奏不续。保留 7 天；重新开始 / 过期会补上旧会话的结束时间，启动时 `cleanup()` 关闭 7 天前没收尾的孤儿会话。不进数据导出，清空数据时清除。训练营顶部显示“未完成的训练”。
- **答案揭示**：指板 / 键盘标签带八度（G4），音高比较与音程题加顺序角标 1、2，同音名不同八度时多一行说明；“逐个播放”按顺序高亮。
- 内置浏览器面板不支持 Service Worker，离线功能需在本机 Chrome 里验证；逻辑由 tests/pwa.test.ts 在模拟环境中测试。
- 钢琴卷帘的格子是鼠标操作，键盘只能用工具栏与按钮。
- 和弦整体弹对无法自动判定（只做分解和弦逐音检测）。
- 内置浏览器面板会拦截麦克风；唱歌和乐器功能需在本机 Chrome 里用 http://localhost:5174 打开。
- Dexie 当前 v10（v10 新增 singTakes / singMeta / covers，并删除 singSongs.phraseBests；v9 新增 singSongs / pitchCurves；v8 新增 audioFiles；v7 新增 sheetFiles、songSheets 加 artist / updatedAt 索引；v6 新增 activeRuns；v5 新增 songSheets；v4 新增 guitarProgress；v2 新增 reviewItems / lessonProgress / compositions；v3 新增 compositionVersions / critiques / generatedExercises / advice）；歌曲作品把 Score 存在 `compositions.score`。
- 只支持 4/4；旋律单声部、不跨小节（不画连音线）。
- 转调只能按段落整体移调；没有离调和弦以外的调式转换。
- MusicXML 只导出主旋律与贝斯，其他轨请用 MIDI。
- 规则引擎只做可测量的检查；平行五八度在流行摇滚里只作提示。
