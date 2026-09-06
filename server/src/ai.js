// 模拟学术 AI 生成引擎 —— 基于模板产出真实感学术中文/英文内容
// 不依赖外部 API，用于演示完整功能与试用扣减逻辑
import Cite from 'citation-js';

const TRANSITIONS = [
  '近年来，',
  '随着相关研究的不断深入，',
  '在现有研究的基础上，',
  '值得注意的是，',
  '从理论层面来看，',
  '实践研究表明，',
  '与此同时，',
  '综合已有文献可以发现，',
];

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ========== 论文写作：大纲 ==========
export function genOutline({ topic, field }) {
  const t = topic || '研究主题';
  const f = field || '本领域';
  return [
    '## 一、引言',
    `  1.1 ${t}的研究背景与意义`,
    '  1.2 国内外研究现状综述',
    '  1.3 研究目的与主要贡献',
    '  1.4 论文结构安排',
    '',
    '## 二、相关理论与技术基础',
    `  2.1 ${f}核心概念界定`,
    '  2.2 理论框架梳理',
    '  2.3 关键技术与方法回顾',
    '',
    '## 三、研究方法与设计',
    '  3.1 研究问题与假设',
    '  3.2 数据来源与样本选取',
    '  3.3 研究模型与变量定义',
    '  3.4 分析流程设计',
    '',
    '## 四、实验与结果分析',
    '  4.1 实验环境与参数设置',
    '  4.2 结果呈现与对比',
    '  4.3 稳健性检验',
    '',
    '## 五、讨论',
    '  5.1 研究发现的理论意义',
    '  5.2 实践启示',
    '  5.3 研究局限与未来方向',
    '',
    '## 六、结论',
    '  6.1 主要结论',
    '  6.2 贡献总结',
    '',
    '参考文献',
  ].join('\n');
}

// ========== 论文写作：段落 ==========
// 分章节生成：每章输出 900+ 字，含章节标题（markdown）与两个小节，
// 按章节类型附带示例三线表或公式（示例数据，标注替换提示）。
export function genParagraph({ topic, field, context }) {
  const t = topic || '研究主题';
  const f = field || '该领域';
  const seed = hashStr(t + f);
  const tr = pick(TRANSITIONS, seed);

  // 从 context 提取当前章节名（chapter-service 注入："当前要撰写章节：XXX"）
  let chapterName = '';
  const cm = String(context || '').match(/当前要撰写章节[:：]\s*(.+)/);
  if (cm) chapterName = cm[1].trim().split('\n')[0];
  const heading = chapterName ? `## ${chapterName}` : `## ${t}研究正文`;

  const isExperiment = /实验|结果|分析|第四章|4\./.test(chapterName);
  const isMethod = /方法|模型|设计|第三章|3\./.test(chapterName);

  const para1 = `${tr}${t}已成为${f}研究中的重要议题，其核心机制与作用路径受到学界的持续关注。早期学者多从单一维度对其进行考察，侧重于概念的界定与现象的描述；随着研究范式的演进，多维度、跨学科的分析框架逐渐成为主流。已有研究表明，${t}的核心机制可从理论建构、实证检验与应用转化三个层面加以理解：理论建构层面关注要素之间的逻辑关系，实证检验层面侧重因果关系的识别，应用转化层面则强调研究成果的实践落地。三个层面相互衔接，共同构成${t}研究的完整图景。`;

  const para2 = `具体而言，在理论建构层面，${t}涉及若干关键变量的交互关系，其作用路径并非线性，而是受到情境因素的调节。情境因素不仅影响变量之间关系的强度，还可能改变关系的作用方向，因此需要在分析框架中给予充分重视。在实证检验层面，已有文献多采用面板数据或实验设计进行识别，但样本范围与度量方式的差异导致结论并不完全一致，部分研究甚至得出了相互矛盾的结论，这提示单一方法可能难以全面揭示${t}的复杂性，方法上的多元化与稳健性检验显得尤为重要。`;

  const para3 = `基于上述分析，本研究认为，对${t}的深入探讨不仅有助于完善${f}的理论体系，也能为相关实践提供更具针对性的决策参考。本文在综合已有研究的基础上，构建了包含核心变量、调节因素与机制变量的综合分析框架，并采用规范的研究方法对研究假设进行系统检验。以下内容将围绕本章主题展开论述，先梳理相关理论基础，再阐明分析方法，最后呈现实证结果并进行讨论，力求形成逻辑完整、证据充分的论证链条。`;

  const para4 = `需要强调的是，${t}的研究并非孤立的理论探讨，而是与${f}领域的发展实践紧密相连。从历史演进来看，${f}领域的每一次重要进展，都为${t}的研究提出了新的问题、提供了新的素材；而${t}研究的深入，又反过来为${f}领域的实践创新提供了理论支撑。这种"理论与实践双向互动"的特征，决定了${t}的研究必须坚持问题导向与证据导向相结合的原则：既要扎根理论脉络，厘清概念与机制；又要面向现实需求，回应实践中的关键问题。本章的论述正是遵循这一原则展开的。`;

  const para5 = `此外，从方法论的角度审视，${t}的研究还面临若干需要审慎处理的技术性问题。其一，核心变量的度量效度问题：不同研究对同一概念的度量方式存在差异，可能影响结论的可比性，因此本研究在变量度量上借鉴成熟量表并进行了信效度检验。其二，样本选择偏差问题：样本的代表性直接决定结论的外推范围，本研究通过多区域、多类型的样本设计加以缓解。其三，潜在的内生性问题：解释变量与被解释变量之间可能存在反向因果或遗漏变量，本研究通过工具变量法与稳健性检验予以应对。对这些方法论问题的清醒认识与规范处理，是保障研究结论科学性的重要前提，也构成了本章乃至全文论证可信度的基础。`;

  const para6 = `从研究现状来看，围绕${t}的学术讨论近年来呈现出三个明显趋势。第一个趋势是研究视角的多元化：单一学科视角已难以充分解释${t}的复杂机制，跨学科融合成为普遍选择，心理学、经济学与管理学的理论与方法被越来越多地引入${f}领域的研究之中。第二个趋势是研究方法的精细化：从早期的描述性分析到如今的因果推断、结构方程建模与机器学习方法，研究工具不断升级，证据质量持续提升。第三个趋势是研究问题的现实化：学术界对${t}的关注越来越多地源于现实需求，研究成果向实践转化的周期明显缩短。把握这三个趋势，有助于准确理解本章内容的学术定位，也有助于判断后续研究的努力方向。`;

  const para7 = `综合以上论述可以看到，${t}的研究既积累了较为丰富的成果，也留下了若干有待深入的空间。已有成果为本章提供了概念基础、理论工具与方法参考；而研究空白则为本章确立了切入角度与论证重点。本章的论述逻辑可以概括为：以概念界定为起点，以理论梳理为支撑，以方法说明为桥梁，最终服务于对${t}核心问题的回答。这一逻辑与全文"提出问题—构建框架—实证检验—讨论总结"的整体设计保持一致，确保了论文结构的连贯性与论证的递进性。`;

  const extra = isExperiment
    ? [
        '',
        '### 本章实证结果',
        '',
        '本章的实证检验遵循规范的计量流程。表 1 报告了主要变量的回归结果（示例数据，请替换为真实数据）：',
        '',
        '| 变量 | 系数 | 标准误 | 显著性 |',
        '|------|------|--------|--------|',
        '| X1 | 0.356 | 0.082 | *** |',
        '| X2 | 0.243 | 0.071 | ** |',
        '| Z | 0.089 | 0.064 | — |',
        '| R² | 0.345 | — | — |',
        '',
        '注：***、**、* 分别表示在 1%、5%、10% 水平显著（示例数据，请替换为真实数据）。',
        '',
        '从回归结果来看，核心解释变量的系数方向与理论预期一致，且通过了显著性检验，说明${t}的核心关系在实证层面得到支持。进一步通过替换度量方式、调整样本区间与引入工具变量等方法进行稳健性检验后，上述结论依然成立，表明研究结果具有较好的可靠性。',
      ]
    : isMethod
    ? [
        '',
        '### 本章方法与模型',
        '',
        '本章采用的分析框架可概括为以下基本模型：',
        '',
        '$$Y = \\beta_0 + \\beta_1 X_1 + \\beta_2 X_2 + \\gamma Z + \\varepsilon$$',
        '',
        '其中，Y 为被解释变量，X₁、X₂为核心解释变量，Z 为情境调节变量，β 为待估参数，ε 为随机扰动项。该模型既可用于识别核心变量的直接影响，也可通过引入交互项考察情境因素的调节作用，满足本章研究目标的需要。',
        '',
        '在具体操作层面，本章遵循"问题界定—模型构建—变量度量—数据准备"的规范流程，并配套相应的质量控制措施，确保后续实证检验的科学性与可复现性。',
      ]
    : [
        '',
        '### 本章小结',
        '',
        `本章围绕${t}的主题内容展开了系统论述，明确了相关概念的内涵与边界，梳理了理论脉络与方法基础，并指出了现有研究的不足与本文的切入空间。上述分析为后续章节的研究设计与实证检验提供了必要的理论准备与方法支撑，也为全文论证逻辑的展开奠定了基础。`,
      ];

  return [heading, '', para1, '', para2, '', para3, '', para4, '', para5, '', para6, '', para7, ...extra].join('\n');
}

// ========== 论文写作：摘要 ==========
export function genAbstract({ topic, field }) {
  const t = topic || '研究主题';
  const f = field || '该领域';
  return [
    '摘要',
    '',
    `本文围绕${t}展开系统研究，旨在揭示其在${f}中的作用机制与实践价值。研究基于相关理论框架，构建了包含核心变量与调节因素的分析模型，并采用实证方法对研究假设进行检验。`,
    '',
    `研究结果表明：(1)${t}对核心结果变量具有显著的正向影响；(2)情境因素在其中发挥调节作用；(3)不同维度的作用路径存在异质性。上述发现丰富了${f}的理论研究，并为实践决策提供了参考依据。`,
    '',
    `关键词：${t}；${f}；作用机制；实证研究`,
  ].join('\n');
}

// ========== 论文写作：全文（毕业论文标准，10000+ 字）==========
// 符合国内高校本科毕业论文字数要求（理工科 10000-15000 字，文科 8000-12000 字）
// 分章节生成，每章充分展开，含图表/公式/表格/参考文献
export function genFullText({ topic, field }) {
  const t = topic || '研究主题';
  const f = field || '该领域';
  const seed = hashStr(t + f);
  const tr = pick(TRANSITIONS, seed);
  const outline = genOutline({ topic: t, field: f });

  // ===== 摘要（400+ 字）=====
  const abstract = [
    '摘要',
    '',
    `${tr}${t}已成为${f}领域备受关注的重点议题，其研究不仅关系到理论体系的完善，也对相关实践具有重要指导价值。然而，现有研究在作用机制的系统性识别、情境因素的调节效应以及不同维度的异质性分析等方面仍存在明显不足，亟需进一步的实证检验与理论拓展。`,
    '',
    `本文围绕${t}展开系统研究，基于相关理论框架构建包含核心解释变量、调节变量与控制变量的分析模型，采用实证研究方法对研究假设进行检验。研究数据来源于公开数据库与问卷调查相结合的方式，样本覆盖多个时间维度与不同区域，以保证结论的稳健性与外推性。在变量度量上，借鉴国内外成熟量表并结合本土情境进行了适当修正。`,
    '',
    `研究结果表明：(1)${t}对核心结果变量具有显著的正向影响，核心解释变量的系数在统计上显著为正，支持本文的主要研究假设；(2)情境因素在其中发挥显著的调节作用，不同情境下作用强度存在明显差异；(3)不同维度的作用路径存在异质性，表明${t}的影响机制具有多层次、多路径的特征。在替换度量方式、调整样本区间及引入工具变量后，上述结论依然稳健。上述发现丰富了${f}的理论研究，揭示了${t}的内在作用机制，并为相关实践决策提供了有针对性的参考依据。`,
    '',
    `关键词：${t}；${f}；作用机制；调节效应；实证研究`,
  ].join('\n');

  // ===== 一、引言（1800+ 字）=====
  const intro = [
    '## 一、引言',
    '',
    '### 1.1 研究背景与意义',
    '',
    `${tr}${f}领域的研究不断推进，${t}作为其中的关键议题，其重要性日益凸显。从宏观背景来看，当前${f}正处于快速发展与深度变革的阶段，相关理论与实践问题层出不穷，对${t}的深入研究具有重要的现实意义。一方面，${t}涉及多个核心变量的交互作用，其内在规律尚未被充分揭示；另一方面，随着研究范式的演进，传统的单一视角已难以全面解释${t}的复杂机制，多维度、跨学科的分析框架逐渐成为主流趋势。`,
    '',
    `从理论层面来看，对${t}的深入探讨有助于完善${f}的理论体系。已有研究虽然在一定程度上揭示了${t}的部分规律，但在作用机制的系统性识别、情境因素的调节效应以及不同维度的异质性分析等方面仍存在明显不足。本研究通过构建综合性分析模型，力图弥补现有研究的不足，为${f}的理论发展提供新的证据与视角。从实践层面来看，${t}的研究成果可为相关决策提供科学依据，有助于提升实践效率与质量，具有显著的应用价值。因此，开展本课题研究具有必要性与紧迫性。`,
    '',
    '### 1.2 国内外研究现状综述',
    '',
    `在国外研究方面，学者们围绕${t}开展了大量探索性工作。早期研究多从基础理论出发，对${t}的概念内涵、构成要素与作用边界进行了系统界定[1]。随着研究的深入，部分学者开始关注${t}的实证检验问题，运用面板数据、实验设计等多种方法识别其影响效应[2]。近年来，国外研究进一步拓展至跨情境比较与动态演化分析，揭示了${t}在不同情境下的作用差异与演化规律[3]。总体来看，国外研究在理论建构与方法创新方面具有领先优势，但其结论的本土适用性仍需进一步检验。`,
    '',
    `在国内研究方面，学者们在借鉴国外理论的基础上，结合本土实际取得了重要进展。部分研究聚焦于${t}的本土化概念界定与理论建构，提出了适用于国内情境的分析框架[4]。另有研究运用实证方法对${t}的影响因素与作用机制进行了检验，得出了具有本土特色的结论[5]。然而，国内研究在样本规模、方法严谨性与情境因素考察等方面仍有提升空间，不同研究的结论并不完全一致，亟待进一步系统检验。`,
    '',
    `综合国内外研究现状可以发现，已有研究在理论建构与实证检验方面取得了重要进展，但仍存在以下不足：一是研究视角相对单一，多从单一维度考察${t}，缺乏多维度的综合分析；二是情境因素的考察不够系统，对调节效应的识别尚不充分；三是不同维度下的异质性特征研究较少，难以揭示${t}影响机制的多层次性。上述不足为本研究提供了切入空间，也是本研究力求突破的方向。`,
    '',
    '### 1.3 研究目的与主要贡献',
    '',
    `基于上述分析，本研究旨在系统考察${t}的作用机制，重点识别核心解释变量的影响效应、情境因素的调节作用以及不同维度的异质性特征。本研究的主要贡献体现在三个方面：第一，在理论层面，构建了包含核心变量与调节因素的综合分析模型，拓展了${f}的理论框架；第二，在方法层面，采用多种稳健性检验方法，提升了结论的可靠性；第三，在实践层面，提出了具有针对性的对策建议，为相关决策提供了参考依据。`,
    '',
    '### 1.4 论文结构安排',
    '',
    '本文共分为六个章节。第一章为引言，介绍研究背景、意义、现状与结构；第二章梳理相关理论与技术基础；第三章阐述研究方法与设计；第四章进行实验与结果分析；第五章讨论研究发现的理论与实践意义；第六章总结全文并提出未来展望。',
  ].join('\n');

  // ===== 二、相关理论与技术基础（2200+ 字）=====
  const theory = [
    '## 二、相关理论与技术基础',
    '',
    '### 2.1 核心概念界定',
    '',
    `${t}的理论基础可追溯至${f}早期的核心范式。学界对其概念界定经历了由窄到宽的演进过程。早期研究倾向于从单一维度对${t}进行定义，强调其某一方面的特征；随着研究的深入，学者们逐渐认识到${t}的多维性与系统性，开始从综合视角对其进行界定[6]。本研究综合已有定义，将${t}理解为在特定情境下、由多要素协同作用而形成的系统性现象，并据此展开后续分析。`,
    '',
    `具体而言，${t}包含若干关键构成要素：一是核心驱动因素，决定${t}的基本方向与强度；二是情境调节因素，影响${t}的作用路径与效果；三是结果表现变量，反映${t}的最终产出。三者之间相互作用、相互影响，共同构成${t}的完整理论框架。对上述要素的清晰界定，是后续模型构建与假设检验的基础。`,
    '',
    '### 2.2 理论框架梳理',
    '',
    `在理论框架方面，本研究主要借鉴了三个相关理论。其一为系统理论，该理论强调要素之间的相互联系与整体性，为理解${t}的系统性特征提供了分析视角[7]。其二为情境理论，该理论关注情境因素对核心关系的调节作用，为识别${t}的作用边界提供了理论依据[8]。其三为实证主义研究范式，强调通过数据与证据检验理论假设，为本研究的实证分析奠定了方法论基础。`,
    '',
    `综合上述理论，本研究构建了"驱动因素—作用机制—情境调节—结果表现"的理论分析框架。在这一框架中，驱动因素通过特定的作用机制影响结果表现，而情境因素则对这一过程发挥调节作用。该框架既体现了${t}的系统性，又兼顾了情境的特殊性，为后续的模型构建与假设提出提供了清晰的理论指引。`,
    '',
    `需要指出的是，上述理论框架并非凭空构建，而是基于对已有研究的系统梳理与批判性整合。系统理论为框架提供了整体性视角，情境理论为框架注入了边界条件意识，实证主义范式则为框架的检验提供了方法论支撑。三者的有机结合使本研究的理论框架既具有学理基础，又具备可检验性，避免了理论建构与实证检验脱节的问题。这一框架也将贯穿后续章节的分析，成为本研究的核心分析逻辑。`,
    '',
    '### 2.3 关键技术与方法回顾',
    '',
    `在研究方法方面，${t}的相关研究主要采用了以下几种方法。一是文献研究法，通过系统梳理国内外相关文献，把握研究脉络与前沿动态；二是实证分析法，运用回归模型、结构方程等方法对研究假设进行检验；三是案例研究法，通过典型个案深化对${t}的理解[9]。不同方法各有侧重，相互补充，共同推动了对${t}的深入研究。`,
    '',
    `在数据分析技术方面，随着计算能力的提升与数据资源的丰富，${t}的研究方法也在不断演进。传统方法主要依赖描述性统计与基础回归分析，而近年来机器学习、文本挖掘等新兴技术逐渐被引入${t}的研究中，为处理复杂数据、识别非线性关系提供了新的工具[10]。本研究在借鉴传统方法的基础上，结合实际需要选择合适的分析技术，以确保研究结论的科学性与可靠性。`,
    '',
    '### 2.4 本章小结',
    '',
    `本章对${t}的核心概念、理论框架与关键技术进行了系统梳理。通过概念界定明确了研究对象的内涵与边界，通过理论框架构建了分析的基础逻辑，通过方法回顾确定了研究的技术路径。上述工作为后续章节的研究设计与实证分析奠定了坚实基础。`,
    '',
    `总体而言，本章的梳理揭示了${t}研究的理论脉络与方法演进，也指出了现有研究的不足与本研究的切入空间。从概念界定到理论框架构建，再到关键技术回顾，本章构建了一个完整的理论分析基础，使得后续的模型构建与假设检验有了坚实的学理支撑。需要强调的是，理论框架的构建并非一劳永逸，随着${f}领域研究的不断推进，相关理论也需持续修正与完善，本研究将在后续章节中根据实证结果对理论框架进行必要调整与深化。`,
  ].join('\n');

  // ===== 三、研究方法与设计（2200+ 字，含流程图与公式）=====
  const method = [
    '## 三、研究方法与设计',
    '',
    '### 3.1 研究问题与假设',
    '',
    `基于上述理论框架，本研究聚焦于以下三个核心问题：第一，${t}的核心驱动因素对结果变量是否具有显著影响？第二，情境因素在其中是否发挥调节作用？第三，不同维度的作用路径是否存在异质性？针对上述问题，本研究提出以下假设：`,
    '',
    `假设 H1：${t}的核心解释变量对结果变量具有显著的正向影响。假设 H2：情境因素对核心关系具有显著的调节作用。假设 H3：不同维度下，核心关系的作用强度存在显著差异。上述假设将在第四章通过实证数据进行检验。`,
    '',
    '### 3.2 研究模型构建',
    '',
    `本研究构建的核心理论模型如下。模型以结果变量 Y 为被解释变量，以核心解释变量 X₁、X₂为主要考察对象，同时引入情境调节变量 Z 与若干控制变量。模型的基本形式为：`,
    '',
    '$$Y = \\beta_0 + \\beta_1 X_1 + \\beta_2 X_2 + \\gamma Z + \\delta (X_1 \\times Z) + \\varepsilon$$',
    '',
    '其中，Y 为被解释变量，X₁、X₂为核心解释变量，Z 为情境调节变量，X₁×Z 为交互项用于识别调节效应，β₀为截距项，β₁、β₂、γ、δ为待估参数，ε为随机扰动项。该模型既可识别核心解释变量的直接影响，又可检验情境因素的调节效应，符合本研究的研究目标。',
    '',
    '图 3-1 研究技术路线图',
    '```mermaid',
    'graph TD',
    '  A[文献调研与问题提出] --> B[理论模型构建]',
    '  B --> C[变量界定与假设提出]',
    '  C --> D[数据收集与处理]',
    '  D --> E{数据质量检验}',
    '  E -->|通过| F[实证模型估计]',
    '  E -->|未通过| D',
    '  F --> G[稳健性检验]',
    '  G --> H[结果分析与讨论]',
    '```',
    '',
    '### 3.3 变量定义与度量',
    '',
    `在变量度量方面，本研究借鉴国内外成熟量表并结合本土情境进行了适当修正。被解释变量 Y 采用多指标综合度量方式，核心解释变量 X₁、X₂均采用李克特五点量表进行测量，情境调节变量 Z 根据研究对象特征进行分组赋值。所有变量的度量均经过信度与效度检验，以确保数据的可靠性。具体而言，量表的 Cronbach's α 系数均在 0.80 以上，组合信度 CR 值大于 0.70，平均方差抽取量 AVE 值大于 0.50，表明量表具有良好的信度与效度[11]。`,
    '',
    '### 3.4 数据来源与样本选取',
    '',
    `本研究数据来源于公开数据库与问卷调查相结合的方式。公开数据库部分用于获取宏观层面与客观数据，问卷调查部分用于获取微观层面与主观评价数据。样本选取遵循代表性与可获得性原则，覆盖多个区域与不同类型的研究对象，最终获得有效样本 500 份。样本的基本特征分布较为均衡，能够满足本研究的需求。`,
    '',
    '### 3.5 分析方法',
    '',
    '本研究主要采用回归分析方法对研究假设进行检验。具体包括：基准回归模型用于识别核心解释变量的直接影响；交互项回归模型用于检验情境因素的调节效应；分组回归用于考察不同维度的异质性特征。此外，还采用替换度量方式、调整样本区间、引入工具变量等方法进行稳健性检验，以提升结论的可靠性。',
    '',
    `在模型估计过程中，本研究严格遵循计量经济学的规范流程。首先，对数据进行多重共线性检验，方差膨胀因子（VIF）均小于 5，表明不存在严重的多重共线性问题。其次，采用 White 检验识别异方差，并在存在异方差时使用稳健标准误进行修正。再次，通过 Hausman 检验确定采用固定效应或随机效应模型。最后，对潜在的内生性问题，采用工具变量法进行修正，工具变量的有效性通过了弱工具变量检验与过度识别检验。上述流程确保了模型估计的科学性与严谨性。`,
    '',
    '### 3.6 数据质量控制',
    '',
    '本研究在数据收集与处理过程中实施了严格的质量控制措施。在问卷设计阶段，邀请领域专家对量表条目进行内容效度评估，并通过预调研（N=80）对量表进行修订，删除因子载荷低于 0.50 的条目。在数据收集阶段，设置注意力检测题项以识别无效作答，同时利用问卷作答时长与重复作答标记剔除不认真作答的样本。在数据处理阶段，对连续变量进行 1% 与 99% 分位数的缩尾处理（Winsorize），以降低极端值对估计结果的干扰；对缺失值采用多重插补方法进行处理，并通过敏感性分析验证插补结果的稳健性。经上述处理后，最终保留有效样本 500 份，有效回收率为 83.3%，满足结构方程模型与回归分析对样本量的基本要求。',
    '',
    '### 3.7 本章小结',
    '',
    '本章完成了研究设计与方法准备：在理论框架基础上提出三项研究假设，构建了包含交互项的计量模型，明确了各变量的定义与度量方式，说明了数据来源、样本选取与质量控制流程，并确定了基准回归、调节效应检验、异质性分析与稳健性检验的完整分析策略。上述工作为第四章的实证检验提供了规范、可复现的操作路径。',
  ].join('\n');

  // ===== 四、实验与结果分析（2800+ 字，含图表与三线表）=====
  const experiment = [
    '## 四、实验与结果分析',
    '',
    '### 4.1 实验环境与参数设置',
    '',
    '本研究的实证分析在标准统计软件环境下完成。回归模型采用普通最小二乘法（OLS）进行估计，同时报告稳健标准误以应对潜在异方差问题。显著性水平设定为 0.05，并辅以 0.01 与 0.10 水平作为参考。所有分析过程均可复现，确保研究结论的可验证性。',
    '',
    '### 4.2 描述性统计',
    '',
    `表 4-1 报告了主要变量的描述性统计结果。从整体来看，各变量的均值、标准差均在合理范围内，数据分布较为均衡，未出现明显的极端值。被解释变量 Y 的均值为 3.52，处于中等偏上水平；核心解释变量 X₁、X₂的均值分别为 2.87 与 3.14，表明样本在核心维度上具有一定差异性，适合进行后续的回归分析。`,
    '',
    '表 4-1 主要变量描述性统计',
    '| 变量 | 样本量 | 均值 | 标准差 | 最小值 | 最大值 |',
    '|------|--------|------|--------|--------|--------|',
    '| Y | 500 | 3.52 | 1.08 | 1.00 | 5.00 |',
    '| X1 | 500 | 2.87 | 0.95 | 1.00 | 4.80 |',
    '| X2 | 500 | 3.14 | 1.12 | 1.00 | 5.00 |',
    '| Z | 500 | 2.65 | 1.05 | 1.00 | 4.50 |',
    '',
    '图 4-1 主要变量均值对比',
    '```vega',
    '{"mark":"bar","data":{"values":[{"x":"Y","y":3.52},{"x":"X1","y":2.87},{"x":"X2","y":3.14},{"x":"Z","y":2.65}]},"encoding":{"x":{"field":"x","type":"nominal","title":"变量"},"y":{"field":"y","type":"quantitative","title":"均值"}}}',
    '```',
    '',
    '### 4.3 基准回归结果',
    '',
    `表 4-2 报告了基准回归模型的结果。模型（1）仅包含核心解释变量 X₁，结果显示 X₁的系数为 0.452，在 1% 水平上显著为正，初步支持假设 H1。模型（2）在模型（1）的基础上加入 X₂，X₁的系数略有下降但仍显著为正，X₂的系数为 0.281，同样在 1% 水平上显著。模型（3）为全模型，包含所有核心变量与控制变量，X₁的系数为 0.356，X₂的系数为 0.243，均显著为正，而控制变量 Z 的系数不显著。上述结果表明，核心解释变量对结果变量具有稳健的正向影响。`,
    '',
    '表 4-2 基准回归分析结果',
    '| 模型 | (1) 基准 | (2) 加入X2 | (3) 全模型 |',
    '|------|---------|-----------|-----------|',
    '| X1 | 0.452*** | 0.398*** | 0.356*** |',
    '| X2 | — | 0.281*** | 0.243** |',
    '| Z | — | — | 0.089 |',
    '| R² | 0.234 | 0.312 | 0.345 |',
    '',
    '注：***、**、* 分别表示在 1%、5%、10% 水平显著。',
    '',
    '图 4-2 各模型拟合优度对比',
    '```vega',
    '{"mark":"line","data":{"values":[{"x":"模型1","y":0.234},{"x":"模型2","y":0.312},{"x":"模型3","y":0.345}]},"encoding":{"x":{"field":"x","type":"nominal","title":"模型"},"y":{"field":"y","type":"quantitative","title":"R²"}}}',
    '```',
    '',
    '### 4.4 调节效应检验',
    '',
    `为检验情境因素的调节效应，本研究在模型（3）的基础上引入交互项 X₁×Z。回归结果显示，交互项的系数为 0.118，在 5% 水平上显著为正，表明情境因素 Z 对 X₁与 Y 的关系具有显著的正向调节作用，支持假设 H2。具体而言，当情境因素水平较高时，核心解释变量对结果变量的影响更为显著；反之，影响相对较弱。这一发现揭示了${t}作用机制的情境依赖性。`,
    '',
    '### 4.5 异质性分析',
    '',
    `为进一步考察不同维度下的作用差异，本研究按照研究对象特征进行分组回归。结果显示，在不同分组中，核心解释变量的系数存在明显差异：高分组中 X₁的系数为 0.412，显著大于低分组的 0.278，且两组系数差异通过了显著性检验，支持假设 H3。上述结果表明，${t}的影响机制具有多层次、多路径的异质性特征。`,
    '',
    `此外，本研究还对不同区域与不同类型样本进行了分组检验。区域层面的分组结果显示，东部地区样本中核心解释变量的系数为 0.385，略高于中西部地区的 0.331，但差异未通过显著性检验，表明区域差异对核心关系的影响有限。类型层面的分组结果显示，大型样本的系数（0.401）显著高于中小型样本（0.295），表明研究对象规模是影响${t}作用强度的重要因素。上述异质性分析进一步丰富了研究结论，为差异化策略的制定提供了依据。`,
    '',
    '### 4.6 稳健性检验',
    '',
    `为确保结论的可靠性，本研究进行了多种稳健性检验。第一，替换度量方式：采用替代指标重新度量核心变量，回归结果与基准模型基本一致。第二，调整样本区间：剔除部分异常样本后重新估计，核心结论依然成立。第三，引入工具变量：采用两阶段最小二乘法（2SLS）处理潜在内生性问题，核心解释变量的系数仍显著为正。综合上述检验，本研究的结论具有较好的稳健性。`,
    '',
    '### 4.7 作用机制进一步分析',
    '',
    '为进一步揭示${t}发挥作用的传导路径，本研究在基准模型的基础上引入中介变量 M（机制变量），构建"X₁ → M → Y"的中介效应检验框架。中介效应检验采用逐步回归法与 Bootstrap 法相结合的方式：逐步回归结果显示，X₁对 M 的回归系数为 0.318（p<0.01），M 对 Y 的回归系数为 0.265（p<0.01），X₁对 Y 的直接效应在加入 M 后由 0.356 下降至 0.287，表明 M 在 X₁与 Y 的关系中发挥了部分中介作用。进一步采用 5000 次 Bootstrap 抽样检验，中介效应值为 0.084，95% 置信区间为 [0.052, 0.119]，不包含 0，中介效应显著成立，中介效应占总效应的比例为 23.6%。',
    '',
    '上述结果表明，${t}对结果变量的影响并非单一的直接路径，而是通过 M 这一机制变量实现了部分传导。这一发现深化了对${t}作用机制的理解：核心驱动因素一方面直接作用于结果变量，另一方面通过改变机制变量 M 的水平间接产生影响。从理论层面看，机制变量的引入丰富了"驱动因素—作用机制—情境调节—结果表现"理论框架的中间环节；从实践层面看，机制分析为干预策略的设计提供了更具操作性的靶点——实践主体不仅可以直接强化核心驱动因素，还可以通过对机制变量 M 的培育与引导，间接提升结果变量的水平，实现"双通道"的干预效果。',
    '',
    '同时，本研究还检验了机制变量 M 在不同情境下的传导强度差异。分组回归结果显示，在高情境组中，中介效应值为 0.102，显著大于低情境组的 0.061，且组间差异通过了显著性检验。这一发现与调节效应检验的结果相互印证：情境因素不仅调节直接效应的强度，也影响中介路径的传导效率，进一步印证了${t}作用机制的情境依赖性。综合直接效应、调节效应与中介效应的分析结果，本研究构建了一个较为完整的"直接作用 + 情境调节 + 机制传导"的多层次解释框架。',
  ].join('\n');

  // ===== 五、讨论（1200+ 字）=====
  const discussion = [
    '## 五、讨论',
    '',
    '### 5.1 研究发现的理论意义',
    '',
    `本研究的发现具有重要的理论意义。首先，证实了${t}的核心解释变量对结果变量的显著正向影响，这一结论与既有文献在方向上基本一致[12]，但在作用强度上提供了新的证据，丰富了${f}的理论研究。其次，识别了情境因素的调节效应，揭示了${t}作用机制的情境依赖性，为理解其内在规律提供了新的视角。再次，发现了不同维度下的异质性特征，表明${t}的影响具有多层次、多路径的特点，拓展了已有研究的分析框架。`,
    '',
    '### 5.2 实践启示',
    '',
    `本研究的发现对实践具有重要启示。一方面，由于核心解释变量对结果变量具有显著正向影响，实践主体应重视核心驱动因素的作用，采取针对性措施提升关键变量的水平。另一方面，情境因素的调节效应提示，在制定相关策略时应充分考虑情境差异，避免"一刀切"的做法。此外，不同维度的异质性特征表明，应根据对象特征进行差异化管理，以提升实践效果。`,
    '',
    `从更宏观的视角来看，本研究的实践启示还体现在策略制定的动态调整上。由于${t}的作用机制具有情境依赖性，实践主体需要建立动态监测与反馈机制，根据情境变化及时调整策略组合。同时，异质性分析的结果提示，针对不同规模、不同类型的研究对象，应设计差异化的干预方案，而非套用统一模板。这种基于实证证据的精细化管理思路，有助于提升资源配置效率，最大化${t}的积极作用，避免资源浪费与策略失效。`,
    '',
    '### 5.3 与已有研究的对比',
    '',
    `本研究的结论与已有研究既有共性也有差异。在核心关系的方向上，本研究与多数已有研究保持一致，均发现正向影响关系；但在作用强度与调节机制上，本研究提供了更为细致的证据，这可能源于样本特征与度量方式的差异。这一对比既验证了已有研究的部分结论，也指出了进一步拓展的方向。`,
    '',
    '### 5.4 研究局限与未来方向',
    '',
    `本研究存在以下局限：一是样本范围有限，主要集中于特定区域与类型，外推性有待提升；二是采用截面数据，难以捕捉${t}的动态演化过程；三是情境因素的考察仍不够全面，可能存在遗漏。未来研究可从以下方向深化：拓展样本规模与区域覆盖，开展纵向追踪研究，引入更多情境因素进行综合考察，并结合新兴技术方法提升分析的深度与广度。`,
    '',
    '### 5.5 综合讨论',
    '',
    '将本研究的三项核心发现置于${f}领域的整体图景中考察，可以形成如下综合判断。第一，核心解释变量的稳健正向效应表明，${t}的基本作用规律具有跨样本、跨情境的普遍性，这为相关理论的推广提供了实证基础。第二，情境调节效应与机制传导路径的发现共同说明，${t}的作用过程是一个"条件依赖 + 路径传导"的复合系统，任何单一维度的考察都会低估其复杂性。第三，异质性分析揭示的分组差异提示，在理论推广与实践应用中必须警惕"平均效应"的遮蔽作用——对于特定群体而言，${t}的作用强度可能显著偏离平均水平，需要差异化的解释与应对。',
    '',
    '上述综合讨论也引出了一个值得关注的研究议题：${t}的作用机制是否随着研究对象特征的变化而发生性质上的改变。本研究的异质性分析虽然发现了强度差异，但受限于截面数据，无法判断这种差异是稳定的结构特征还是阶段性的演化现象。若未来研究能够结合纵向数据与定性资料，对${t}作用机制的性质稳定性进行考察，将有助于进一步厘清其理论边界，并为更具针对性的实践策略提供依据。',
  ].join('\n');

  // ===== 六、结论（600+ 字）=====
  const conclusion = [
    '## 六、结论',
    '',
    '### 6.1 主要结论',
    '',
    `本文系统考察了${t}的作用机制，通过构建综合分析模型并进行实证检验，得出以下主要结论：第一，${t}的核心解释变量对结果变量具有显著的正向影响，支持了假设 H1；第二，情境因素在其中发挥显著的调节作用，揭示了作用机制的情境依赖性，支持了假设 H2；第三，不同维度下作用强度存在显著差异，体现了${t}影响的异质性特征，支持了假设 H3。上述结论在多种稳健性检验下依然成立，具有较好的可靠性。`,
    '',
    '### 6.2 贡献总结',
    '',
    `本研究的主要贡献体现在理论与实践两个方面。在理论层面，构建了包含核心变量、调节因素与异质性考察的综合分析框架，拓展了${f}的理论体系，揭示了${t}的内在作用机制。在实践层面，提出了具有针对性的对策建议，为相关决策提供了科学依据。本研究为${f}的理论发展与实践应用提供了有力支撑，也为后续研究奠定了基础。`,
    '',
    '### 6.3 研究展望',
    '',
    '未来研究可以在以下方面进一步深化：其一，拓展样本的时间跨度与空间覆盖，提升结论的外部效度；其二，引入纵向数据与动态分析方法，揭示${t}的演化规律；其三，结合实验研究与田野调查，深化因果机制的识别；其四，探索${t}在新兴技术条件下的新特征与新规律。通过上述努力，有望推动${f}领域研究向更深层次发展。',
    '',
    '参考文献',
    '',
    '[1] Smith J, Brown A. Theoretical foundations of ' + t + '[J]. Journal of ' + f + ' Studies, 2018, 15(2): 112-125.',
    '[2] Johnson R, Lee C. Empirical analysis on ' + t + '[J]. International Journal of Research, 2019, 28(3): 256-270.',
    '[3] Anderson T, et al. Dynamic mechanisms of ' + t + '[J]. Science Progress, 2020, 33(4): 412-428.',
    '[4] 张明, 李华. ' + t + '的理论建构与本土化研究[J]. 学术研究, 2021(5): 45-52.',
    '[5] 王强, 刘洋. ' + t + '影响因素的实证检验[J]. 研究学报, 2022(8): 78-85.',
    '[6] 陈晓. ' + t + '的概念演进与分析框架[J]. 学科前沿, 2020(3): 12-20.',
    '[7] Davis M. Systems theory and its applications[M]. New York: Academic Press, 2017.',
    '[8] Wilson K. Contextual factors in research design[J]. Methodology Review, 2019, 12(1): 33-48.',
    '[9] 赵丽, 孙伟. ' + t + '研究方法综述[J]. 方法论研究, 2021(6): 90-97.',
    '[10] Taylor P, Martinez R. Machine learning approaches in ' + f + '[J]. Computational Studies, 2022, 18(2): 145-160.',
    '[11] Hair J F, et al. Multivariate data analysis[M]. 8th ed. Cengage Learning, 2019.',
    '[12] 刘芳, 等. ' + t + '作用机制的再考察[J]. 综合研究, 2023(4): 56-65.',
    '',
    '本文由 AI 生成的所有内容（文字、文档、图表、公式等）仅供学习与参考，不构成任何学术成果或建议，严禁直接用于论文写作、作业提交、考试、投稿、查重等任何学术场景；因违规使用产生的一切后果由使用者自行承担。',
  ].join('\n');

  return [
    abstract,
    '',
    '──────────────────',
    '',
    outline,
    '',
    '──────────────────',
    '',
    intro,
    '',
    theory,
    '',
    method,
    '',
    experiment,
    '',
    discussion,
    '',
    conclusion,
  ].join('\n');
}

// ========== 论文润色 ==========
export function polishText({ text }) {
  if (!text || !text.trim()) return { result: '', changes: [] };
  const original = text.trim();
  const replacements = [
    [/我觉得/g, '笔者认为'],
    [/我们认为/g, '本研究认为'],
    [/很/g, '较为'],
    [/特别/g, '尤为'],
    [/所以/g, '因此'],
    [/但是/g, '然而'],
    [/还有就是/g, '此外，'],
    [/这个东西/g, '该要素'],
    [/用的方法/g, '所采用的方法'],
    [/说一下/g, '阐述'],
    [/看一看/g, '考察'],
    [/做研究/g, '开展研究'],
    [/比较/g, '相对'],
    [/越来越多/g, '日益增多的'],
    [/很重要/g, '具有重要意义'],
  ];
  let result = original;
  const changes = [];
  for (const [re, to] of replacements) {
    if (re.test(result)) {
      result = result.replace(re, to);
      changes.push(`将「${re.source}」优化为「${to}」`);
    }
  }
  return {
    result,
    changes: changes.length ? changes : ['已对语句结构进行学术化优化，提升表达严谨性'],
  };
}

// ========== 中英翻译 ==========
const ZH2EN = {
  摘要: 'Abstract',
  引言: 'Introduction',
  研究: 'research',
  方法: 'method',
  结果: 'result',
  结论: 'conclusion',
  本文: 'This paper',
  提出: 'proposes',
  分析: 'analyzes',
  表明: 'indicates',
  显著: 'significant',
  影响: 'effect',
  理论: 'theory',
  实证: 'empirical',
  数据: 'data',
  模型: 'model',
  变量: 'variable',
};

const EN2ZH = {
  Abstract: '摘要',
  Introduction: '引言',
  research: '研究',
  method: '方法',
  result: '结果',
  conclusion: '结论',
  'This paper': '本文',
  proposes: '提出',
  analyzes: '分析',
  indicates: '表明',
  significant: '显著的',
  effect: '影响',
  theory: '理论',
  empirical: '实证',
  data: '数据',
  model: '模型',
  variable: '变量',
};

export function translateText({ text, direction }) {
  if (!text || !text.trim()) return '';
  if (direction === 'zh2en') {
    const sentences = text.split(/(?<=[。！？])/);
    const out = sentences.filter((s) => s.trim()).map((s) => {
      let en = s;
      for (const [zh, en2] of Object.entries(ZH2EN)) en = en.replaceAll(zh, en2);
      en = en.replace(/。/g, '.').replace(/，/g, ', ').replace(/：/g, ': ').replace(/（/g, '(').replace(/）/g, ')');
      return en.trim();
    });
    return out.join(' ');
  } else {
    let zh = text;
    for (const [en, zh2] of Object.entries(EN2ZH)) zh = zh.replaceAll(en, zh2);
    zh = zh.replace(/\.\s*/g, '。').replace(/,\s*/g, '，').replace(/:\s*/g, '：');
    return zh;
  }
}

// ========== 语法纠错（中英文，纯 JS 实现） ==========
// 检测常见中英文语法错误，返回 { result, issues }
// issues: [{ type, original, suggestion, message, position }]

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 在文本中扫描正则的所有匹配，返回 [{ match, index, groups }]
function scanMatches(text, re) {
  const out = [];
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const rx = new RegExp(re.source, flags);
  let m;
  while ((m = rx.exec(text)) !== null) {
    out.push({ match: m[0], index: m.index, groups: m.slice(1) });
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

// 按位置倒序应用修复，保证索引不偏移
function applyFixesReverse(text, fixes) {
  const sorted = [...fixes].sort((a, b) => b.index - a.index);
  let out = text;
  for (const f of sorted) {
    out = out.slice(0, f.index) + f.replacement + out.slice(f.index + f.length);
  }
  return out;
}

// 保留原匹配首字母大小写
function preserveCase(original, replacement) {
  if (original && replacement && /[A-Z]/.test(original.charAt(0)) && /[a-z]/.test(original.slice(1))) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// a/an 例外词
const EN_AN_WORDS = new Set(['hour', 'honest', 'honor', 'heir', 'honorarium', 'honorable']);
const EN_A_WORDS = new Set(['university', 'union', 'unit', 'use', 'user', 'uniform', 'unique', 'european', 'one', 'once', 'utility', 'usable', 'used']);

// 英文专有名词（小写时提示首字母大写）
const EN_PROPER_NOUNS = ['china', 'chinese', 'beijing', 'shanghai', 'english', 'america', 'american', 'europe', 'european', 'asia', 'asian', 'africa', 'african', 'germany', 'german', 'france', 'french', 'japan', 'japanese', 'korea', 'korean'];

// will + 过去式 → 动词原形
const WILL_PAST_TO_BASE = {
  went: 'go', came: 'come', did: 'do', saw: 'see', made: 'make', took: 'take',
  had: 'have', was: 'be', were: 'be', been: 'be', done: 'do', gone: 'go',
  come: 'come', seen: 'see', played: 'play', written: 'write', given: 'give',
};

// 中文常见动词字与形容词补语
const ZH_VERB_CHARS = '跑走说做写看听想吃喝打唱学用买卖开始完成继续';
const ZH_ADJ_AFTER_VERB = '快慢好坏多少高低大小对错清楚明白漂亮认真努力深浅';

// 中文常见副词（的→地）
const ZH_ADV_DE = ['慢慢的', '快快的', '认真的', '仔细的', '努力的', '积极的', '飞快的', '大声的', '小心的', '高兴的', '迅速的', '稳步的', '持续的', '不断的', '深入的', '广泛的', '系统的'];

// 中文冗余表达
const ZH_REDUNDANT = [
  { re: /进行([^，。；！？\n]{1,8}?)的研究/g, to: '研究$1', msg: '冗余表达「进行…的研究」，建议简化为「研究…」' },
  { re: /进行([^，。；！？\n]{1,8}?)的分析/g, to: '分析$1', msg: '冗余表达「进行…的分析」，建议简化为「分析…」' },
  { re: /进行([^，。；！？\n]{1,8}?)的探讨/g, to: '探讨$1', msg: '冗余表达「进行…的探讨」，建议简化为「探讨…」' },
  { re: /做出了([^，。；！？\n]{1,12}?)的贡献/g, to: '贡献了$1', msg: '冗余表达「做出了…的贡献」，建议简化为「贡献了…」' },
  { re: /对([^，。；！？\n]{1,10}?)进行研究/g, to: '研究$1', msg: '冗余表达「对…进行研究」，建议简化为「研究…」' },
  { re: /对([^，。；！？\n]{1,10}?)进行分析/g, to: '分析$1', msg: '冗余表达「对…进行分析」，建议简化为「分析…」' },
];

// 字符二元组 Jaccard 相似度（用于相邻句子重复检测）
function charBigramSet(s) {
  const clean = s.replace(/[\s\p{P}\p{S}]/gu, '');
  const set = new Set();
  for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
  return set;
}
function jaccardSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export function grammarCheck({ text }) {
  if (!text || !text.trim()) return { result: '', issues: [] };
  const issues = [];
  const fixes = []; // { index, length, replacement }

  // ===== 保留原有规则：关联词重复、口语化关联词 =====
  for (const pos of scanMatches(text, /因此所以/g)) {
    issues.push({ type: 'redundant_conjunction', original: pos.match, suggestion: '因此', message: '关联词重复「因此所以」，二者择一', position: pos.index });
    fixes.push({ index: pos.index, length: pos.match.length, replacement: '因此' });
  }
  for (const pos of scanMatches(text, /(?<=[，。])另外(?=[，。])/g)) {
    issues.push({ type: 'colloquial_conjunction', original: pos.match, suggestion: '此外', message: '口语化关联词「另外」，学术写作建议用「此外」', position: pos.index });
    fixes.push({ index: pos.index, length: pos.match.length, replacement: '此外' });
  }

  // ============ 英文语法检测 ============
  // 1. 主谓一致
  const svPatterns = [
    { re: /\b(he|she|it)(\s+)(have|do|are|were)\b/gi, fix: { have: 'has', do: 'does', are: 'is', were: 'was' } },
    { re: /\b(they|we|you)(\s+)(has|is|was|does)\b/gi, fix: { has: 'have', is: 'are', was: 'were', does: 'do' } },
    { re: /\b(this|that)(\s+)(have|do|are|were)\b/gi, fix: { have: 'has', do: 'does', are: 'is', were: 'was' } },
    { re: /\b(these|those)(\s+)(has|is|was|does)\b/gi, fix: { has: 'have', is: 'are', was: 'were', does: 'do' } },
    { re: /\b(everyone|someone|anyone|nobody|each)(\s+)(have|are|were|do)\b/gi, fix: { have: 'has', are: 'is', were: 'was', do: 'does' } },
  ];
  for (const p of svPatterns) {
    for (const pos of scanMatches(text, p.re)) {
      const parts = pos.match.split(/\s+/);
      const subj = parts[0];
      const verb = parts[parts.length - 1];
      const fixed = p.fix[verb.toLowerCase()];
      if (!fixed) continue;
      const replacement = `${subj} ${fixed}`;
      issues.push({ type: 'subject_verb_agreement', original: pos.match, suggestion: replacement, message: `主谓一致：主语「${subj}」应搭配动词「${fixed}」而非「${verb}」`, position: pos.index });
      fixes.push({ index: pos.index, length: pos.match.length, replacement });
    }
  }
  // data/media 等集合名词作复数（提示，不自动改）
  for (const pos of scanMatches(text, /\b(data|media)\s+(shows|is|was|has|does)\b/gi)) {
    const parts = pos.match.split(/\s+/);
    const subj = parts[0];
    const verb = parts[1];
    const pluralMap = { shows: 'show', is: 'are', was: 'were', has: 'have', does: 'do' };
    const fixed = pluralMap[verb.toLowerCase()];
    if (!fixed) continue;
    issues.push({ type: 'subject_verb_agreement', original: pos.match, suggestion: `${subj} ${fixed}`, message: `主谓一致：「${subj}」在学术写作中通常作复数，建议搭配「${fixed}」而非「${verb}」`, position: pos.index });
  }

  // 2. 冠词 a/an 误用
  for (const pos of scanMatches(text, /\b(a|an)\s+([A-Za-z]\w*)/g)) {
    const article = pos.groups[0].toLowerCase();
    const word = pos.groups[1];
    const wl = word.toLowerCase();
    const startsVowelLetter = /^[aeiou]/.test(wl);
    let expected = article;
    if (article === 'a' && startsVowelLetter && !EN_A_WORDS.has(wl)) expected = 'an';
    if (article === 'an' && !startsVowelLetter && !EN_AN_WORDS.has(wl)) expected = 'a';
    if (expected !== article) {
      const replacement = `${expected} ${word}`;
      issues.push({ type: 'article_usage', original: pos.match, suggestion: replacement, message: `冠词使用：「${word}」前应使用「${expected}」而非「${article}」`, position: pos.index });
      fixes.push({ index: pos.index, length: pos.match.length, replacement });
    }
  }

  // 3. 时态混淆：will + 过去式
  for (const pos of scanMatches(text, /\bwill\s+(went|came|did|saw|made|took|had|was|were|been|done|gone|come|seen|played|written|given)\b/gi)) {
    const verb = pos.match.split(/\s+/).pop().toLowerCase();
    const base = WILL_PAST_TO_BASE[verb] || verb;
    issues.push({ type: 'tense_confusion', original: pos.match, suggestion: `will ${base}`, message: `时态混淆：will 后应接动词原形「${base}」，而非过去式「${verb}」`, position: pos.index });
  }

  // 4. 标点：逗号拼接
  for (const pos of scanMatches(text, /,\s+(I|he|she|they|we|you|it|this|that|these|those)\s+(is|are|was|were|have|has|will|can|should|must|do|does|did)\b/g)) {
    const rest = pos.match.slice(1).trim();
    issues.push({ type: 'comma_splice', original: pos.match, suggestion: `; ${rest}`, message: '逗号拼接：两个独立子句不宜仅用逗号连接，建议改用分号、句号或加并列连词', position: pos.index });
  }
  // 重复标点
  for (const pos of scanMatches(text, /([。！？.!?])\1+/g)) {
    issues.push({ type: 'punctuation', original: pos.match, suggestion: pos.match[0], message: `重复标点「${pos.match}」，建议仅保留一个`, position: pos.index });
    fixes.push({ index: pos.index, length: pos.match.length, replacement: pos.match[0] });
  }

  // 5. 大小写：句首小写
  for (const pos of scanMatches(text, /(?:^|[。！？.!?]\s+|\n\s*)([a-z])/g)) {
    const letter = pos.groups[0];
    const letterIdx = pos.index + pos.match.length - 1;
    // 排除缩写（如 Mr. Dr. St. 后接小写）
    const ctx = text.slice(Math.max(0, pos.index - 2), pos.index + 1);
    if (/[A-Z][a-z]\.$/.test(ctx)) continue;
    issues.push({ type: 'capitalization', original: letter, suggestion: letter.toUpperCase(), message: '句首字母应大写', position: letterIdx });
    fixes.push({ index: letterIdx, length: 1, replacement: letter.toUpperCase() });
  }
  // 专有名词小写
  for (const noun of EN_PROPER_NOUNS) {
    const re = new RegExp('\\b' + noun + '\\b', 'g');
    for (const pos of scanMatches(text, re)) {
      const cap = pos.match.charAt(0).toUpperCase() + pos.match.slice(1);
      issues.push({ type: 'capitalization', original: pos.match, suggestion: cap, message: `专有名词「${pos.match}」首字母应大写`, position: pos.index });
      fixes.push({ index: pos.index, length: pos.match.length, replacement: cap });
    }
  }

  // 6. 拼写混淆（their/there/they're, its/it's, affect/effect, your/you're）
  const confusables = [
    { re: /\btheir\s+(is|are|was|were)\b/gi, to: (m) => m.replace(/^their/i, 'there'), msg: 'their（他们的）与 there（那里/存在）混淆' },
    { re: /\bthere\s+(going|coming|leaving|doing|making|playing)\b/gi, to: (m) => m.replace(/^there/i, "they're"), msg: "there 与 they're（他们正在）混淆" },
    { re: /\bthey're\s+(house|car|book|name|family|mother|father|friend|cat|dog|country)\b/gi, to: (m) => m.replace(/^they're/i, 'their'), msg: "they're（他们是）与 their（他们的）混淆" },
    { re: /\bits\s+(a|the)\b/gi, to: (m) => m.replace(/^its/i, "it's"), msg: "its（它的）与 it's（它是）混淆" },
    { re: /\bit's\s+(color|colour|size|shape|name|tail|fur|surface|content|structure|price|value|use)\b/gi, to: (m) => m.replace(/^it's/i, 'its'), msg: "it's（它是）与 its（它的）混淆" },
    { re: /\bthe\s+affect\s+of\b/gi, to: (m) => m.replace(/affect/i, 'effect'), msg: 'affect（动词）与 effect（名词）混淆' },
    { re: /\baffect\s+(on|was|were)\b/gi, to: (m) => m.replace(/^affect/i, 'effect'), msg: '此处应为名词 effect 而非动词 affect' },
    { re: /\byour\s+(going|coming|leaving|doing|right|wrong)\b/gi, to: (m) => m.replace(/^your/i, "you're"), msg: "your（你的）与 you're（你是）混淆" },
  ];
  for (const c of confusables) {
    for (const pos of scanMatches(text, c.re)) {
      const replacement = preserveCase(pos.match, c.to(pos.match));
      issues.push({ type: 'word_confusion', original: pos.match, suggestion: replacement, message: c.msg, position: pos.index });
      fixes.push({ index: pos.index, length: pos.match.length, replacement });
    }
  }

  // ============ 中文语法检测 ============
  // 1. 的/地/得 混用
  // (a) 副词 + 的 + 动词 → 地
  for (const adv of ZH_ADV_DE) {
    const re = new RegExp(escapeRegExp(adv) + `([${ZH_VERB_CHARS}])`, 'g');
    for (const pos of scanMatches(text, re)) {
      const replacement = adv.slice(0, -1) + '地' + pos.groups[0];
      issues.push({ type: 'de_di_de', original: pos.match, suggestion: replacement, message: `「的/地」混用：副词修饰动词应用「地」，即「${adv.slice(0, -1)}地${pos.groups[0]}」`, position: pos.index });
      fixes.push({ index: pos.index, length: pos.match.length, replacement });
    }
  }
  // (b) 动词 + 的 + 形容词补语 → 得
  const verbDeAdjRe = new RegExp(`([${ZH_VERB_CHARS}])的([${ZH_ADJ_AFTER_VERB}])`, 'g');
  for (const pos of scanMatches(text, verbDeAdjRe)) {
    const replacement = pos.groups[0] + '得' + pos.groups[1];
    issues.push({ type: 'de_di_de', original: pos.match, suggestion: replacement, message: `「的/得」混用：动词后接补语应用「得」，即「${pos.groups[0]}得${pos.groups[1]}」`, position: pos.index });
    fixes.push({ index: pos.index, length: pos.match.length, replacement });
  }

  // 2. 中英文标点混用（中文后跟英文标点）
  const zhPunctMap = { '.': '。', ',': '，', '?': '？', '!': '！', ';': '；', ':': '：' };
  for (const pos of scanMatches(text, /[\u4e00-\u9fa5]([.,?!;:])/g)) {
    const asciiP = pos.groups[0];
    const zhP = zhPunctMap[asciiP];
    if (!zhP) continue;
    const replacement = pos.match.replace(asciiP, zhP);
    issues.push({ type: 'punctuation_mixed', original: pos.match, suggestion: replacement, message: `中英文标点混用：中文后应使用「${zhP}」而非「${asciiP}」`, position: pos.index });
    fixes.push({ index: pos.index, length: pos.match.length, replacement });
  }

  // 3. 句子过长（>80字）
  const sentenceList = [];
  const sentRe = /[^。！？.!?;\n]+[。！？.!?;]*/g;
  let sm;
  while ((sm = sentRe.exec(text)) !== null) {
    const s = sm[0].trim();
    if (s) sentenceList.push({ text: s, index: sm.index + sm[0].indexOf(s) });
  }
  sentenceList.forEach((s, i) => {
    if (s.text.length > 80) {
      issues.push({ type: 'long_sentence', original: s.text.slice(0, 40) + (s.text.length > 40 ? '…' : ''), suggestion: '建议拆分为多个短句', message: `句子过长（${s.text.length} 字，第 ${i + 1} 句），建议拆分以提升可读性`, position: s.index });
    }
  });

  // 4. 相邻句子高度相似（重复表达）
  const bigrams = sentenceList.map((s) => charBigramSet(s.text));
  for (let i = 1; i < sentenceList.length; i++) {
    if (sentenceList[i].text.length < 6) continue;
    const sim = jaccardSimilarity(bigrams[i - 1], bigrams[i]);
    if (sim >= 0.5) {
      issues.push({ type: 'repetition', original: sentenceList[i].text.slice(0, 40) + (sentenceList[i].text.length > 40 ? '…' : ''), suggestion: '调整句式或用词以降低重复', message: `相邻句子高度相似（字符二元组 Jaccard 相似度 ${(sim * 100).toFixed(0)}%），存在重复表达`, position: i });
    }
  }

  // 5. 中文冗余表达
  for (const r of ZH_REDUNDANT) {
    for (const pos of scanMatches(text, r.re)) {
      const replacement = pos.match.replace(r.re, r.to);
      issues.push({ type: 'redundant_expression', original: pos.match, suggestion: replacement, message: r.msg, position: pos.index });
      fixes.push({ index: pos.index, length: pos.match.length, replacement });
    }
  }

  // 应用所有确定性修复
  const result = applyFixesReverse(text, fixes);
  return { result, issues };
}

// ========== 论文降重 ==========
// 学术常用同义词替换词典
const REWRITE_SYNONYMS = [
  [/近年来/g, '近些年来'],
  [/随着/g, '伴随着'],
  [/研究表明/g, '相关研究揭示'],
  [/研究显示/g, '相关研究证实'],
  [/众所周知/g, '学界普遍认同'],
  [/综上所述/g, '由上述分析可知'],
  [/总而言之/g, '概言之'],
  [/因此/g, '由此可见'],
  [/所以/g, '故而'],
  [/但是/g, '然而'],
  [/不过/g, '然而'],
  [/而且/g, '此外'],
  [/另外/g, '此外'],
  [/非常重要/g, '具有关键意义'],
  [/很重要/g, '具有重要意义'],
  [/广泛/g, '普遍'],
  [/深入/g, '系统'],
  [/有效/g, '切实'],
  [/显著/g, '明显'],
  [/主要/g, '核心'],
  [/提出/g, '构建'],
  [/分析/g, '剖析'],
  [/探讨/g, '考察'],
  [/影响/g, '作用'],
  [/导致/g, '引发'],
  [/需要/g, '亟需'],
  [/通过/g, '借助'],
  [/基于/g, '立足于'],
  [/利用/g, '运用'],
  [/采用/g, '采纳'],
  [/实现/g, '达成'],
  [/包括/g, '涵盖'],
  [/包含/g, '涵盖'],
  [/提高/g, '提升'],
  [/促进/g, '推动'],
  [/发展/g, '演进'],
  [/方法/g, '途径'],
  [/问题/g, '议题'],
];

// 关联词替换（与同义词词典互斥，避免链式替换）
const REWRITE_CONJUNCTIONS = [
  [/虽然/g, '尽管'],
  [/因为/g, '鉴于'],
  [/由于/g, '考虑到'],
];

export function rewriteText({ text }) {
  if (!text || !text.trim()) {
    return { result: '', changes: [] };
  }

  let result = text;
  const changes = [];

  // 1. 同义词替换（比较替换前后内容，避免正则 lastIndex 状态问题）
  for (const [re, to] of REWRITE_SYNONYMS) {
    const prev = result;
    result = result.replace(re, to);
    if (result !== prev) {
      changes.push(`同义替换：「${re.source.replace(/\\g$/, '')}」→「${to}」`);
    }
  }

  // 2. 关联词替换
  for (const [re, to] of REWRITE_CONJUNCTIONS) {
    const prev = result;
    result = result.replace(re, to);
    if (result !== prev) {
      changes.push(`关联词替换为「${to}」`);
    }
  }

  // 3. 句式微调：调整并列连词与节奏（保守处理，仅替换冗余表达）
  const conjPhrases = [
    [/，并且/g, '，同时'],
    [/，然后/g, '，随后'],
    [/，所以/g, '，故而'],
  ];
  for (const [re, to] of conjPhrases) {
    const prev = result;
    result = result.replace(re, to);
    if (result !== prev) changes.push(`句式调整：并列连接「${re.source.replace(/\\g$/, '').replace(/，/g, '，')}」→「${to}」`);
  }

  if (changes.length === 0) {
    changes.push('已对语句结构进行优化调整，提升表达多样性');
  }

  return { result, changes };
}

// ========== 参考文献格式化 ==========
// APA/MLA 改用 citation.js 生成；GB/T 7714 因中文学术场景需求特殊，保持原有手写模板。
// citation.js 内置 CSL 模板含 apa/vancouver/harvard1，未内置 mla；MLA 分支尝试
// citation.js，若模板不可用或调用失败，回退到下方简单模板。
// 将系统作者字符串解析为 CSL-JSON author 数组
function parseAuthorsForCsl(authorsStr) {
  if (!authorsStr || !authorsStr.trim()) return [];
  const s = authorsStr.trim();
  let parts;
  if (/\.,\s/.test(s)) {
    // 西文多作者 "Family, G., Family2, G2."：按 "., " 切分
    parts = s
      .split(/\.,\s*/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (p.endsWith('.') ? p : p + '.'));
  } else {
    parts = s.split(/,\s*/).map((p) => p.trim()).filter(Boolean);
    // 单个 "Family, Init."（仅一段逗号且后半段为缩写）视为一位作者
    if (parts.length === 2 && /^[A-Z]\.?$/.test(parts[1])) {
      return [{ family: parts[0], given: parts[1] }];
    }
  }
  return parts.map((name) => {
    const m = name.match(/^([^,]+),\s*(.+)$/);
    if (m) return { family: m[1].trim(), given: m[2].trim() };
    return { literal: name };
  });
}

// 系统 ref_type -> CSL type
function refTypeToCsl(ref_type) {
  switch (ref_type) {
    case 'journal':
      return 'article-journal';
    case 'book':
      return 'book';
    case 'thesis':
      return 'thesis';
    default:
      return 'article-journal';
  }
}

// 将系统文献对象转为 CSL-JSON
function refToCslJson(ref) {
  const json = {
    type: refTypeToCsl(ref.ref_type),
    title: ref.title || '',
    author: parseAuthorsForCsl(ref.authors),
  };
  if (ref.year) {
    const y = parseInt(ref.year, 10);
    json.issued = { 'date-parts': [[Number.isNaN(y) ? ref.year : y]] };
  }
  if (ref.journal) json['container-title'] = ref.journal;
  if (ref.publisher) json.publisher = ref.publisher;
  if (ref.doi) json.DOI = ref.doi;
  return json;
}

// 用 citation.js 按指定模板格式化；失败时抛出由调用方回退
function formatWithCitationJs(ref, template) {
  const cite = new Cite([refToCslJson(ref)]);
  const out = cite.format('bibliography', { format: 'text', template });
  return (typeof out === 'string' ? out : String(out)).trim();
}

// citation.js 不可用或模板缺失时的简单回退模板
function fallbackApa(ref, authorStr, yearStr) {
  const { title, journal, publisher, ref_type, doi } = ref;
  if (ref_type === 'journal') {
    let s = `${authorStr} (${yearStr}). ${title}. ${journal || 'Journal'}`;
    if (doi) s += `, https://doi.org/${doi}`;
    return s + '.';
  }
  return `${authorStr} (${yearStr}). ${title}. ${publisher || 'Publisher'}.`;
}

function fallbackMla(ref, authorStr, yearStr) {
  const { title, journal, publisher, ref_type } = ref;
  if (ref_type === 'journal') {
    return `${authorStr}. "${title}." ${journal || 'Journal'}, ${yearStr}.`;
  }
  return `${authorStr}. ${title}. ${publisher || 'Publisher'}, ${yearStr}.`;
}

export function formatReference({ ref, style }) {
  const { authors, title, year, journal, publisher, ref_type, doi } = ref;
  const authorStr = authors || '佚名';
  const yearStr = year || 'n.d.';

  if (style === 'apa') {
    try {
      return formatWithCitationJs(ref, 'apa');
    } catch (_e) {
      return fallbackApa(ref, authorStr, yearStr);
    }
  }

  if (style === 'mla') {
    try {
      return formatWithCitationJs(ref, 'mla');
    } catch (_e) {
      return fallbackMla(ref, authorStr, yearStr);
    }
  }

  // 默认 GB/T 7714（保持原有手写模板，中文学术场景需求特殊）
  if (ref_type === 'journal') {
    let s = `${authorStr}. ${title}[J]. ${journal || '期刊'}, ${yearStr}.`;
    if (doi) s += ` DOI: ${doi}.`;
    return s;
  }
  if (ref_type === 'book') {
    return `${authorStr}. ${title}[M]. ${publisher || '出版社'}, ${yearStr}.`;
  }
  const tag = (ref_type || 'Z')[0].toUpperCase();
  return `${authorStr}. ${title}[${tag}]. ${yearStr}.`;
}
