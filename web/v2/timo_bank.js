/* ======== TIMO 奥数题库（2026-11-19）：K2/幼稚园组 + 小学一年级 Primary 1 ========
 *
 * 来源：/Volumes/S/Workplace/timo-papers（TIMO 完整题本，52 份 PDF）。
 * 只取两个年级能做的 4 份（Kindergarten 2017 heat / 2018 final、Primary 1 2018 question paper /
 * 2020-2021 mock）。2019 final、2021-2022 final 属 P1 决赛卷（含棱柱、多位比较），
 * 先不进本库，留作「挑战」档后续再加。
 *
 * 每题都改写成了口语题面（q 中文 qy 粤语 qe 英文），答案在 PDF 原文答案页核对过；
 * 带图形的题（天秤、正方形计数、立方体）不进本库：语音讲不清，留在「看作业」里拍。
 *
 * 字段：
 *   lv   'k2' | 'p1'      档位（幼稚园 K2 组 / 小学一年级）
 *   sec  题型分区
 *   q/qy/qe  题面（普通话 / 粤语口语 / 英文）
 *   a    正确答案（字符串，比较时归一化）
 *   ans  答案类型：'num' 数字 | 'choice' 从 opts 里选
 *   opts 选项（choice 用）；optse 英文界面显示/口答用的选项（可选，和 opts 一一对应）
 *   hint/hinty/hinte  提示（不给答案）
 *   exp 讲解
 *   src  出处
 * 语音交互的判题在页面里做（数字键盘或选项按钮），提示/讲解走 /api/hw/tts。
 */
(function () {
  'use strict';

  const BANK = [
    /* ---------- TIMO-2017-heat-Kindergarten ---------- */
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q1',
      q: '积及的爸爸有四个孩子，其中两个是儿子。积及一共有多少个兄弟姊妹？', qy: '积及爸爸有四个细路，当中两个系仔。积及一共有几多个兄弟姊妹？', qe: 'Jacob\'s father has four children. Two of them are sons. How many brothers and sisters does Jacob have in total?',
      a: '2', ans: 'num',
      hint: '想一想：四个孩子里两个是儿子，另外两个呢？', hinty: '谂下：四个细路两个系仔，另外两个系咩？', hinte: 'Think: four children, two are sons. What are the other two?',
      expe: 'Two of the four children are sons, so the other two are daughters. Jacob is one of the sons, so he has 2 siblings.',
    },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q2',
      q: '图中两个天秤：第一个天秤圆球比三角重，第二个天秤三角比方块重。圆球、三角、方块哪个最重？', qy: '图中两个天秤：第一个天秤圆球重过三角，第二个天秤三角重过方块。圆球、三角、方块边个最重？', qe: 'Two balances: the ball is heavier than the triangle, and the triangle is heavier than the square. Which is heaviest?',
      a: '圆球', ans: 'choice', opts: ['圆球', '三角', '方块'], optse: ['ball', 'triangle', 'square'],
      hint: '天秤往下的一边更重。', hinty: '天秤向下嘅一边更重。', hinte: 'The side that goes down is heavier.',
      exp: '圆球比三角重，三角又比方块重，所以圆球最重。', expe: 'Ball beats triangle, triangle beats square, so the ball is heaviest.',
      howto: '比轻重先看每台天秤哪边低，把两条比较连起来排顺序。', howtoe: 'Read which pan is lower, then chain the comparisons.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q3',
      q: '按规律：1、1、2、3、5、8，下一个是多少？', qy: '跟规律：1、1、2、3、5、8，下一个系几多？', qe: 'Pattern: 1, 1, 2, 3, 5, 8. What comes next?',
      a: '13', ans: 'num',
      hint: '把前面两个数加起来看看。', hinty: '试下将前面两个数加起来。', hinte: 'Try adding the two numbers before it.',
      expe: 'Each number is the sum of the two before it: 5 + 8 = 13.',
    },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q4',
      q: '按规律：1、1、2、3、5、8，下一个是多少？', qy: '跟规律：1、1、2、3、5、8，下一个系几多？', qe: 'Pattern: 1, 1, 2, 3, 5, 8. What comes next?',
      a: '13', ans: 'num',
      hint: '把前面两个数加起来看看。', hinty: '试下将前面两个数加起来。', hinte: 'Try adding the two numbers before it.',
      exp: '每个数是前面两个数之和：5 加 8 等于 13。', expe: 'Each number is the sum of the two before it: 5 + 8 = 13.',
      howto: '规律题先算相邻两数的差，差在变就试试两项相加。', howtoe: 'Check the differences first; if they change, try adding the two previous terms.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q5',
      q: '按规律：第 1 组 1 个星，第 2 组 3 个星，第 3 组 5 个星，每组比上一组多 2 个。第 4 组有多少个星？', qy: '跟规律：第 1 组 1 个星，第 2 组 3 个星，第 3 组 5 个星，每组比上一组多 2 个。第 4 组有几多个星？', qe: 'Group 1 has 1 star, group 2 has 3, group 3 has 5, each group 2 more than the last. How many in group 4?',
      a: '7', ans: 'num',
      hint: '第 3 组 5 个，再多 2 个就是第 4 组。', hinty: '第 3 组 5 个，再多 2 个就系第 4 组。', hinte: 'Group 3 has 5; two more gives group 4.',
      exp: '5 加 2 等于 7，所以第 4 组有 7 个星。', expe: '5 + 2 = 7, so group 4 has 7 stars.',
      howto: '先算每组之间的差，再用最后一组加上这个差。', howtoe: 'Find the step between groups, then add it to the last group.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q6',
      q: '3 加 3 加 3 加 3 加 3 等于多少？', qy: '3 加 3 加 3 加 3 加 3 等于几多？', qe: 'What is 3 + 3 + 3 + 3 + 3?',
      a: '15', ans: 'num',
      hint: '3 个 3 是 9，再加两个 3。', hinty: '3 个 3 系 9，再加两个 3。', hinte: 'Three 3s make 9. Add two more 3s.',
      expe: 'Five 3s added together make 15, which is 3 × 5.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q7',
      q: '17 减 8 再减 7 等于多少？', qy: '17 减 8 再减 7 等于几多？', qe: 'What is 17 − 8 − 7?',
      a: '2', ans: 'num',
      hint: '先算 17 减 8。', hinty: '先算 17 减 8。', hinte: 'Start with 17 minus 8.',
      expe: '17 − 8 = 9, then 9 − 7 = 2.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q8',
      q: 'A 是一位数，12 减 A 等于 8，A 是多少？', qy: 'A 系一位数，12 减 A 等于 8，A 系几多？', qe: 'A is a 1-digit number and 12 − A = 8. What is A?',
      a: '4', ans: 'num',
      hint: '想：12 减几多等于 8？', hinty: '谂：12 减幾多等于 8？', hinte: 'What do you take from 12 to get 8?',
      exp: '12 减 8 等于 4，所以 A 是 4。', expe: '12 − 8 = 4, so A is 4.',
      howto: '求减数用减法：被减数减差，算完把 A 代回去验算。', howtoe: 'Subtrahend = start − result; substitute back to check.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q9',
      q: '14 加 11 加 8 等于多少？', qy: '14 加 11 加 8 等于几多？', qe: 'What is 14 + 11 + 8?',
      a: '33', ans: 'num',
      hint: '先算 14 加 11。', hinty: '先算 14 加 11。', hinte: 'First do 14 + 11.',
      expe: '14 + 11 = 25, then 25 + 8 = 33.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q10',
      q: 'A 是一位数，37 加 A 等于 40，A 是多少？', qy: 'A 系一位数，37 加 A 等于 40，A 系几多？', qe: 'A is a 1-digit number and 37 + A = 40. What is A?',
      a: '3', ans: 'num',
      hint: '想：37 再加几多就是 40？', hinty: '谂：37 再加幾多就系 40？', hinte: 'How much more than 37 makes 40?',
      exp: '40 减 37 等于 3，所以 A 是 3。', expe: '40 − 37 = 3, so A is 3.',
      howto: '求加数用和减已知数，再把答案加回去验算。', howtoe: 'Addend = total − known part; check by adding back.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q11',
      q: '艾美有 8 个苹果，约翰一个都没有。要让两人苹果一样多，艾美要给约翰多少个？', qy: '艾美有 8 个苹果，约翰一个都冇。要让两个人一样多，艾美要畀约翰几多个？', qe: 'Amy has 8 apples and John has none. How many apples must Amy give John so they have the same number?',
      a: '4', ans: 'num',
      hint: '两个人一样多，每人应该是几个？', hinty: '两个人一样多，每人应该有幾多个？', hinte: 'If they end up equal, how many would each have?',
      expe: 'Split 8 apples into two equal shares of 4, so Amy gives John 4 apples.',
    },
    { lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q12',
      q: '在 2、3、4、5 之间填加号或减号，使 2 3 4 5 = 14 成立。第一个符号是加还是减？', qy: '喺 2、3、4、5 之间填加号或者减号，令 2 3 4 5 = 14 成立。第一个符号系加定减？', qe: 'Put + or − between 2, 3, 4, 5 so the result is 14. Is the first sign + or −?',
      a: '+', ans: 'choice', opts: ['+', '−'], optse: ['+', '−'],
      hint: '先把四个数全加起来看看和是多少。', hinty: '先将四个数全部加埋睇下和系几多。', hinte: 'Add all four first and see the total.',
      exp: '2 加 3 加 4 加 5 等于 14，全是加号，所以第一个是加号。', expe: '2 + 3 + 4 + 5 = 14, all plus, so the first sign is +.',
      howto: '先全加得到和，比目标大就把某个加号换成减号，每换一个结果少两倍那个数。', howtoe: 'Add everything; each plus turned to minus lowers the total by twice that number.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q13',
      q: '在 5、4、3 之间填加号或减号，使 5 4 3 = 4 成立。第一个符号是加还是减？', qy: '喺 5、4、3 之间填加号或者减号，令 5 4 3 = 4 成立。第一个符号系加定减？', qe: 'Put + or − between 5, 4, 3 so the result is 4. Is the first sign + or −?',
      a: '−', ans: 'choice', opts: ['+', '−'], optse: ['+', '−'],
      hint: '只有两种填法，都试一遍。', hinty: '只有两种填法，两种都试一次。', hinte: 'There are only two arrangements; try both.',
      exp: '5 减 4 加 3 等于 4，成立；5 加 4 减 3 等于 6，不对。所以第一个是减号。', expe: '5 − 4 + 3 = 4 works; 5 + 4 − 3 = 6 does not. First sign is −.',
      howto: '符号题数量少就穷举，不要凭感觉猜。', howtoe: 'With few signs, enumerate every arrangement.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q14',
      q: 'A 是一位数，12 减 A 等于 5 加 4，A 是多少？', qy: 'A 系一位数，12 减 A 等于 5 加 4，A 系几多？', qe: 'A is a 1-digit number and 12 − A = 5 + 4. What is A?',
      a: '3', ans: 'num',
      hint: '先算右边 5 加 4。', hinty: '先算右边 5 加 4。', hinte: 'Work out 5 + 4 first.',
      exp: '5 加 4 等于 9，12 减 9 等于 3，所以 A 是 3。', expe: '5 + 4 = 9, 12 − 9 = 3, so A = 3.',
      howto: '等式右边先算成一个数，再按求减数的方法做。', howtoe: 'Simplify the right side, then find the missing subtrahend.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q15',
      q: '按规律：13、11、9、7，下一个是多少？', qy: '跟规律：13、11、9、7，下一个系几多？', qe: 'Pattern: 13, 11, 9, 7. What comes next?',
      a: '5', ans: 'num',
      hint: '每次少了多少？', hinty: '每次少咗几多？', hinte: 'How much does it go down each time?',
      expe: 'It goes down by 2 each time, so the next number is 5.',
    },
    { lv: 'k2', sec: '几何', src: 'TIMO-2017-heat-Kindergarten Q16',
      q: '一个正方形被分成 2 行 2 列的 4 个小正方形。图中一共有多少个正方形（大小都算）？', qy: '一个正方形分成 2 行 2 列嘅 4 个细正方形。图中一共有幾多个正方形（大细都计）？', qe: 'A square is cut into 2 rows and 2 columns of small squares. How many squares in total, counting all sizes?',
      a: '5', ans: 'num',
      hint: '4 个小的，还有外面包着的大正方形。', hinty: '4 个细嘅，仲有外面包住嘅大正方形。', hinte: '4 small ones plus the big square around them.',
      exp: '4 个小正方形加 1 个大正方形，一共 5 个。', expe: '4 small plus 1 big: 5 squares.',
      howto: '数正方形按大小分类：先数最小的，再数几个小格拼成的，别只数一种。', howtoe: 'Count by size: smallest first, then those built from several cells.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2017-heat-Kindergarten Q17',
      q: '一堆立方体：上面 1 个，下面 3 个。最少由多少个立方体组成？', qy: '一堆立方体：上面 1 个，下面 3 个。最少由幾多个立方体组成？', qe: 'A stack of cubes: 1 on top, 3 below. At least how many cubes?',
      a: '4', ans: 'num',
      hint: '上面的 1 个要算，下面 3 个也要算。', hinty: '上面 1 个要计，下面 3 个都要计。', hinte: 'Count the top one and the three below.',
      exp: '1 加 3 等于 4 个。', expe: '1 + 3 = 4 cubes.',
      howto: '数立方体按层数，上面的每一块下面都要有一块托住。', howtoe: 'Count layer by layer; every upper cube needs one below.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2017-heat-Kindergarten Q18',
      q: '一个五边形，外面看有 5 条边。这个图形有多少条边？', qy: '一个五边形，外面睇有 5 条边。呢个图形有几多条边？', qe: 'A pentagon has 5 sides on the outside. How many sides does it have?',
      a: '5', ans: 'num',
      hint: '五边形就是 5 条边。', hinty: '五边形就系 5 条边。', hinte: 'Pentagon means five sides.',
      exp: '五边形有 5 条边。', expe: 'A pentagon has 5 sides.',
      howto: '数边时一条一条数，接在一起的边只算一次。', howtoe: 'Count each edge once; shared edges count once.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2017-heat-Kindergarten Q19',
      q: '一个六边形有多少只角？', qy: '一个六边形有几多只角？', qe: 'How many angles does a hexagon have?',
      a: '6', ans: 'num',
      hint: '有几个顶点就有几只角。', hinty: '有几个顶点就有几只角。', hinte: 'One angle per corner.',
      exp: '六边形有 6 只角。', expe: 'A hexagon has 6 angles.',
      howto: '多边形的角数、边数、顶点数都一样多。', howtoe: 'Angles, sides and corners of a polygon are equal in number.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2017-heat-Kindergarten Q20',
      q: '按规律：圆、方、三角、圆、方、三角、圆、__、三角。空格是什么？', qy: '跟规律：圆、方、三角、圆、方、三角、圆、__、三角。空格系咩？', qe: 'Pattern: circle, square, triangle, circle, square, triangle, circle, __, triangle. What fills the blank?',
      a: '方', ans: 'choice', opts: ['圆', '方', '三角'], optse: ['circle', 'square', 'triangle'],
      hint: '三个一循环，第 8 个是循环里的第二个。', hinty: '三个一循环，第 8 个系循环里面嘅第二个。', hinte: 'Repeats every three; the 8th is the second in the cycle.',
      exp: '三个一循环，第 8 个落在第二个位置，就是方。', expe: 'The 8th position is the second of the cycle: square.',
      howto: '先找循环长度，再算第几个落在循环的哪一格。', howtoe: 'Find the cycle length, then locate the position inside it.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q21',
      q: '把 10 颗星分成一样多的两份，每份多少颗？', qy: '将 10 粒星分成一样多嘅两份，每份幾多粒？', qe: 'Split 10 stars into two equal groups. How many stars in each group?',
      a: '5', ans: 'num',
      hint: '一半是多少？', hinty: '一半系幾多？', hinte: 'What is half of 10?',
      expe: 'Half of 10 is 5.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q22',
      q: '下面这些数里有多少个奇数（单数）：1、2、3、6、11、20、37、68？', qy: '下面呢啲数里面有几个奇数（单数）：1、2、3、6、11、20、37、68？', qe: 'How many odd numbers are there: 1, 2, 3, 6, 11, 20, 37, 68?',
      a: '4', ans: 'num',
      hint: '奇数的个位是 1、3、5、7、9。', hinty: '奇数嘅个位系 1、3、5、7、9。', hinte: 'Odd numbers end in 1, 3, 5, 7 or 9.',
      expe: '1, 3, 11 and 37 are odd, so there are 4 odd numbers.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q23',
      q: '下面这些数里有多少个偶数（双数）：1、4、5、9、14、23、37、60？', qy: '下面呢啲数里面有几个偶数（双数）：1、4、5、9、14、23、37、60？', qe: 'How many even numbers are there: 1, 4, 5, 9, 14, 23, 37, 60?',
      a: '3', ans: 'num',
      hint: '偶数的个位是 0、2、4、6、8。', hinty: '偶数嘅个位系 0、2、4、6、8。', hinte: 'Even numbers end in 0, 2, 4, 6 or 8.',
      expe: '4, 14 and 60 are even, so there are 3 even numbers.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q24',
      q: '用 1、2、4 三个数字各用一次，能组成最大的三位数是多少？', qy: '用 1、2、4 三个数字每个用一次，可以组成最大嘅三位数系几多？', qe: 'Use the digits 1, 2 and 4 once each to make the largest 3-digit number. What is it?',
      a: '421', ans: 'num',
      hint: '最大的数字放百位。', hinty: '最大嘅数字放百位。', hinte: 'Put the biggest digit in the hundreds place.',
      expe: 'Put the digits from biggest to smallest: 421.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q25',
      q: '彼得有 4 枚 1 元、2 枚 5 元和 1 枚 10 元硬币，他最多能买多少元的纪念品？', qy: '彼得有 4 个 1 蚊、2 个 5 蚊同 1 个 10 蚊，佢最多买幾多蚊嘅纪念品？', qe: 'Peter has 4 one-dollar coins, 2 five-dollar coins and 1 ten-dollar coin. What is the most he can spend?',
      a: '24', ans: 'num',
      hint: '先把所有钱加起来。', hinty: '先将所有钱加埋。', hinte: 'Add all the coins up.',
      expe: '4 × 1 + 2 × 5 + 10 = 4 + 10 + 10 = 24 dollars.',
    },

    /* ---------- TIMO-2018-final-Kindergarten ---------- */
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q1',
      q: '积及是家里最小的男孩，他有 4 个姐姐、没有哥哥弟弟。积及家一共有多少个孩子？', qy: '积及系屋企最细嘅仔，佢有 4 个家姐、冇兄弟。积及屋企一共有几个细路？', qe: 'Jacob is the youngest boy, with 4 elder sisters and no brothers. How many children are in the family?',
      a: '5', ans: 'num',
      hint: '别忘了算积及自己。', hinty: '唔好漏咗积及自己。', hinte: 'Remember to count Jacob himself.',
      expe: '4 sisters plus Jacob himself makes 5 children.',
    },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q2',
      q: '图中两个天秤：第一个天秤圆球比三角轻，第二个天秤三角比方块轻。圆球、三角、方块哪个最轻？', qy: '图中两个天秤：第一个天秤圆球轻过三角，第二个天秤三角轻过方块。圆球、三角、方块边个最轻？', qe: 'Two balances: the ball is lighter than the triangle, and the triangle is lighter than the square. Which is lightest?',
      a: '圆球', ans: 'choice', opts: ['圆球', '三角', '方块'], optse: ['ball', 'triangle', 'square'],
      hint: '天秤往上翘的那边更轻。', hinty: '天秤向上翘嗰边更轻。', hinte: 'The pan that rises is lighter.',
      exp: '圆球最轻，三角次之，方块最重。', expe: 'Ball lightest, then triangle, then square.',
      howto: '把两段比较连成一条线，就能从轻到重排出来。', howtoe: 'Chain the two comparisons to rank from light to heavy.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q3',
      q: '按规律：A、C、E、G、I，下一个字母是什么？', qy: '跟规律：A、C、E、G、I，下一个字母系咩？', qe: 'Pattern: A, C, E, G, I. What letter comes next?',
      a: 'K', ans: 'choice', opts: ['J', 'K', 'L', 'M'],
      hint: '字母表里每次跳过几个？', hinty: '字母表里面每次跳过几个？', hinte: 'How many letters are skipped each time?',
      expe: 'The letters skip one each time: A, C, E, G, I, then K.',
    },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q4',
      q: '按规律：1、8、3、6、5、4，下一个是多少？', qy: '跟规律：1、8、3、6、5、4，下一个系几多？', qe: 'Pattern: 1, 8, 3, 6, 5, 4. What comes next?',
      a: '7', ans: 'num',
      hint: '一个在变大，一个在变小，看看分别怎么走。', hinty: '一个系变大，一个系变细，睇下佢哋点行。', hinte: 'One sequence goes up, one goes down. Look at each.',
      expe: 'The odd places go 1, 3, 5, 7 (+2 each) and the even places go 8, 6, 4 (−2 each), so the next is 7.',
    },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q5',
      q: '按规律：第 1 组 1 个圆，第 2 组 2 个圆，第 3 组 3 个圆。第 4 组有多少个圆？', qy: '跟规律：第 1 组 1 个圆，第 2 组 2 个圆，第 3 组 3 个圆。第 4 组有几多个圆？', qe: 'Group 1 has 1 circle, group 2 has 2, group 3 has 3. How many in group 4?',
      a: '4', ans: 'num',
      hint: '每组比上一组多 1 个。', hinty: '每组比上一组多 1 个。', hinte: 'Each group has one more than the last.',
      exp: '3 加 1 等于 4。', expe: '3 + 1 = 4.',
      howto: '找出每组之间加几多，再加一次。', howtoe: 'Find the step between groups and apply it once.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q6',
      q: '2 加 2 加 2 加 2 加 2 等于多少？', qy: '2 加 2 加 2 加 2 加 2 等于几多？', qe: 'What is 2 + 2 + 2 + 2 + 2?',
      a: '10', ans: 'num',
      hint: '数一数有几个 2。', hinty: '数下有幾多个 2。', hinte: 'Count how many 2s there are.',
      expe: 'Five 2s added together make 10, which is 2 × 5.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q7',
      q: '18 减 6 再减 8 等于多少？', qy: '18 减 6 再减 8 等于几多？', qe: 'What is 18 − 6 − 8?',
      a: '4', ans: 'num',
      hint: '先算 18 减 6。', hinty: '先算 18 减 6。', hinte: 'Start with 18 minus 6.',
      expe: '18 − 6 = 12, then 12 − 8 = 4.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q8',
      q: 'A 是一位数，10 减 A 等于 3，A 是多少？', qy: 'A 系一位数，10 减 A 等于 3，A 系几多？', qe: 'A is a 1-digit number and 10 − A = 3. What is A?',
      a: '7', ans: 'num',
      hint: '想：10 减几多还剩 3？', hinty: '谂：10 减幾多仲剩 3？', hinte: 'What do you take from 10 to leave 3?',
      exp: '10 减 3 等于 7，所以 A 是 7。', expe: '10 − 3 = 7, so A = 7.',
      howto: '求减数用减法，再代回去验算。', howtoe: 'Subtrahend = start − result; check by substitution.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q9',
      q: '10 减 9 加 8 减 7 加 6 减 5 加 4 减 3 加 2 减 1 等于多少？', qy: '10 减 9 加 8 减 7 加 6 减 5 加 4 减 3 加 2 减 1 等于几多？', qe: 'What is 10 − 9 + 8 − 7 + 6 − 5 + 4 − 3 + 2 − 1?',
      a: '5', ans: 'num',
      hint: '把成对的数放在一起算：10−9、8−7……', hinty: '将一对一对嘅数放埋一齐算：10−9、8−7……', hinte: 'Pair them up: 10−9, 8−7, and so on.',
      expe: 'Each pair like 10 − 9 or 8 − 7 equals 1. There are 5 pairs, so the total is 5.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q10',
      q: 'A 是一位数，12 加 A 等于 20，A 是多少？', qy: 'A 系一位数，12 加 A 等于 20，A 系几多？', qe: 'A is a 1-digit number and 12 + A = 20. What is A?',
      a: '8', ans: 'num',
      hint: '想：12 加几多等于 20？', hinty: '谂：12 加幾多等于 20？', hinte: 'How much do you add to 12 to reach 20?',
      exp: '20 减 12 等于 8，所以 A 是 8。', expe: '20 − 12 = 8, so A = 8.',
      howto: '求加数用和减已知数，再验算。', howtoe: 'Addend = total − known part; check by substitution.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q11',
      q: '艾美有 7 个梨，约翰有 1 个。要让两人一样多，艾美要给约翰多少个？', qy: '艾美有 7 个梨，约翰有 1 个。要让两个人一样多，艾美要畀约翰幾多个？', qe: 'Amy has 7 pears and John has 1. How many must Amy give John so they have the same?',
      a: '3', ans: 'num',
      hint: '一共 8 个梨，一样多的话每人几个？', hinty: '一共 8 个梨，一样多嘅话每人幾多个？', hinte: 'There are 8 pears in total. If equal, how many each?',
      expe: 'There are 8 pears, so 4 each. John already has 1, so Amy gives him 3.',
    },
    { lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q12',
      q: '在 2、4、3、1 之间填加号或减号，使 2 4 3 1 = 10 成立。第一个符号是加还是减？', qy: '喺 2、4、3、1 之间填加号或者减号，令 2 4 3 1 = 10 成立。第一个符号系加定减？', qe: 'Put + or − between 2, 4, 3, 1 so the result is 10. Is the first sign + or −?',
      a: '+', ans: 'choice', opts: ['+', '−'], optse: ['+', '−'],
      hint: '先把四个数全加起来看看。', hinty: '先将四个数全部加埋睇下。', hinte: 'Add all four first.',
      exp: '2 加 4 加 3 加 1 等于 10，全是加号。', expe: '2 + 4 + 3 + 1 = 10, all plus.',
      howto: '先全加，比目标大再换减号。', howtoe: 'Add all first; switch to minus if the total is too big.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q13',
      q: '在 6、1、3 之间填加号或减号，使 6 1 3 = 2 成立。第一个符号是加还是减？', qy: '喺 6、1、3 之间填加号或者减号，令 6 1 3 = 2 成立。第一个符号系加定减？', qe: 'Put + or − between 6, 1, 3 so the result is 2. Is the first sign + or −?',
      a: '−', ans: 'choice', opts: ['+', '−'], optse: ['+', '−'],
      hint: '6 减 1 再减 3 等于多少？', hinty: '6 减 1 再减 3 等于几多？', hinte: 'What is 6 − 1 − 3?',
      exp: '6 减 1 再减 3 等于 2，所以第一个是减号。', expe: '6 − 1 − 3 = 2, so the first sign is −.',
      howto: '两种填法都算一遍，6 加 1 减 3 是 4，不对。', howtoe: 'Try both; 6 + 1 − 3 = 4 does not work.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q14',
      q: 'A 是一位数，11 减 A 等于 4 加 3，A 是多少？', qy: 'A 系一位数，11 减 A 等于 4 加 3，A 系几多？', qe: 'A is a 1-digit number and 11 − A = 4 + 3. What is A?',
      a: '4', ans: 'num',
      hint: '先算右边 4 加 3 等于多少。', hinty: '先算右边 4 加 3 等于几多。', hinte: 'Work out 4 + 3 first.',
      exp: '4 加 3 等于 7，11 减 7 等于 4，所以 A 是 4。', expe: '4 + 3 = 7, 11 − 7 = 4, so A = 4.',
      howto: '右边先算成一个数，再求减数。', howtoe: 'Simplify the right side, then find the subtrahend.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q15',
      q: '按规律：10、7、4，下一个是多少？', qy: '跟规律：10、7、4，下一个系几多？', qe: 'Pattern: 10, 7, 4. What comes next?',
      a: '1', ans: 'num',
      hint: '每次少了多少？', hinty: '每次少咗几多？', hinte: 'How much is taken away each time?',
      expe: 'It goes down by 3 each time, so 4 − 3 = 1.',
    },
    { lv: 'k2', sec: '几何', src: 'TIMO-2018-final-Kindergarten Q16',
      q: '一个正方形被分成 2 行 2 列的 4 个小正方形。图中一共有多少个正方形（大小都算）？', qy: '一个正方形分成 2 行 2 列嘅 4 个细正方形。图中一共有幾多个正方形（大细都计）？', qe: 'A square is cut into 2 rows and 2 columns. How many squares in total?',
      a: '5', ans: 'num',
      hint: '4 个小的加 1 个大的。', hinty: '4 个细嘅加 1 个大嘅。', hinte: '4 small plus 1 big.',
      exp: '4 加 1 等于 5。', expe: '4 + 1 = 5.',
      howto: '按大小分类数，别漏掉大的。', howtoe: 'Count by size, including the large one.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2018-final-Kindergarten Q17',
      q: '一堆立方体：上面 2 个，下面 4 个。最少由多少个立方体组成？', qy: '一堆立方体：上面 2 个，下面 4 个。最少由幾多个立方体组成？', qe: 'A stack of cubes: 2 on top, 4 below. At least how many cubes?',
      a: '6', ans: 'num',
      hint: '上面 2 个，下面 4 个，加起来。', hinty: '上面 2 个，下面 4 个，加埋。', hinte: 'Two on top plus four below.',
      exp: '2 加 4 等于 6。', expe: '2 + 4 = 6.',
      howto: '按层数数，被挡住的也要算。', howtoe: 'Count by layer, including hidden cubes.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2018-final-Kindergarten Q18',
      q: '一个正方形旁边接一个三角形组成一个图形。这个图形一共有多少条边？', qy: '一个正方形旁边接一个三角形组成一个图形。呢个图形一共有几多条边？', qe: 'A square with a triangle attached. How many sides in total?',
      a: '5', ans: 'num',
      hint: '正方形 4 条边，接上三角形后共用的那条只算一次。', hinty: '正方形 4 条边，接上三角形之后共用嗰条只计一次。', hinte: 'The square has 4 sides; the shared side counts once.',
      exp: '外面数一圈是 5 条边。', expe: 'Walking around the outside gives 5 sides.',
      howto: '数边时接在一起的边只算一次。', howtoe: 'Count each edge once, including shared ones.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2018-final-Kindergarten Q19',
      q: '一个三角形被一条线分成 2 个小三角形。图中一共有多少个三角形（大小都算）？', qy: '一个三角形被一条线分成 2 个细三角形。图中一共有幾多个三角形（大细都计）？', qe: 'A triangle is split by one line into 2 small triangles. How many triangles in total?',
      a: '3', ans: 'num',
      hint: '2 个小的加上原来的大三角形。', hinty: '2 个细嘅加埋原来嘅大三角形。', hinte: '2 small ones plus the original big triangle.',
      exp: '2 加 1 等于 3。', expe: '2 + 1 = 3.',
      howto: '数图形按大小分类，别只数小的。', howtoe: 'Count by size, not only the small ones.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2018-final-Kindergarten Q20',
      q: '按规律：方、圆、三角、方、圆、三角、方、__、三角。空格是什么？', qy: '跟规律：方、圆、三角、方、圆、三角、方、__、三角。空格系咩？', qe: 'Pattern: square, circle, triangle, square, circle, triangle, square, __, triangle. What fills the blank?',
      a: '圆', ans: 'choice', opts: ['方', '圆', '三角'], optse: ['square', 'circle', 'triangle'],
      hint: '三个一循环，第 8 个是循环里的第二个。', hinty: '三个一循环，第 8 个系循环里面嘅第二个。', hinte: 'Repeats every three; the 8th is the second.',
      exp: '三个一循环，第 8 个落在第二个位置，就是圆。', expe: 'The 8th position is the second of the cycle: circle.',
      howto: '先找循环长度再定位。', howtoe: 'Find the cycle length first.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q21',
      q: '把 8 颗星分成一样多的两份，每份多少颗？', qy: '将 8 粒星分成一样多嘅两份，每份幾多粒？', qe: 'Split 8 stars into two equal groups. How many in each group?',
      a: '4', ans: 'num',
      hint: '一半是多少？', hinty: '一半系幾多？', hinte: 'What is half of 8?',
      expe: 'Half of 8 is 4.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q22',
      q: '下面这些算式里有多少个结果是奇数：1 加 3、2 加 4、3 加 5、8 加 4、2 加 5？', qy: '下面呢啲算式里面有几多个结果系奇数：1 加 3、2 加 4、3 加 5、8 加 4、2 加 5？', qe: 'How many of these sums are odd: 1+3, 2+4, 3+5, 8+4, 2+5?',
      a: '1', ans: 'num',
      hint: '先算每个和，再看个位是不是 1、3、5、7、9。', hinty: '先算每个和，再睇个位系唔系 1、3、5、7、9。', hinte: 'Compute each sum, then check the units digit.',
      exp: '1+3=4、2+4=6、3+5=8、8+4=12、2+5=7，只有 7 是奇数，共 1 个。', expe: 'Only 7 is odd, so the answer is 1.',
      howto: '奇数加偶数得奇数；先把每个和算出来再判单双。', howtoe: 'Odd + even gives odd; compute each sum then test parity.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q23',
      q: '下面这些算式里有多少个结果是一位数：14 加 3、4 加 5、7 加 9、3 加 5？', qy: '下面呢啲算式里面有几多个结果系一位数：14 加 3、4 加 5、7 加 9、3 加 5？', qe: 'How many of these sums are single-digit: 14+3, 4+5, 7+9, 3+5?',
      a: '2', ans: 'num',
      hint: '先算每个和是几多。', hinty: '先算每个和系几多。', hinte: 'Work out each sum.',
      exp: '14+3=17、4+5=9、7+9=16、3+5=8，一位数的是 9 和 8，共 2 个。', expe: '9 and 8 are single-digit: 2 of them.',
      howto: '先算和再数位数，两位数不算。', howtoe: 'Compute each sum then count the digits.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q24',
      q: '下面这些数里有多少个两位数：2、14、15、27、4、32、47？', qy: '下面呢啲数里面有几个两位数：2、14、15、27、4、32、47？', qe: 'How many two-digit numbers are there: 2, 14, 15, 27, 4, 32, 47?',
      a: '5', ans: 'num',
      hint: '两位数要有十位。', hinty: '两位数要有十位。', hinte: 'Two-digit numbers need a tens digit.',
      expe: 'Two-digit numbers need a tens digit: 14, 15, 27, 32 and 47, so 5 of them (2 and 4 are single digits).',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q25',
      q: '彼得有 6 枚 1 元硬币，能换多少个 2 元硬币？', qy: '彼得有 6 个 1 蚊硬币，可以换幾多个 2 蚊硬币？', qe: 'Peter has 6 × $1 coins. How many $2 coins can he exchange for?',
      a: '3', ans: 'num',
      hint: '6 除以 2。', hinty: '6 除以 2。', hinte: '6 ÷ 2.',
      exp: '6 除以 2 等于 3。', expe: '6 ÷ 2 = 3.',
      howto: '换钱是平均分，用除法，验算用乘法。', howtoe: 'Exchanging money is division; check by multiplying.' },

    /* ---------- TIMO-2018-Primary-1 ---------- */
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q1',
      q: '玛丽有一个哥哥和三个妹妹，玛丽的哥哥有几个妹妹？', qy: '玛丽有一个哥哥同三个妹妹，玛丽嘅哥哥有几多个妹妹？', qe: 'Mary has one brother and three sisters. How many sisters does Mary\'s brother have?',
      a: '4', ans: 'num',
      hint: '哥哥的妹妹里，玛丽自己也算一个。', hinty: '哥哥嘅妹妹里面，玛丽自己都算一个。', hinte: 'Mary herself counts as one of the brother\'s sisters.',
      exp: '玛丽加三个妹妹，一共 4 个。', expe: 'Mary plus three sisters: 4.',
      howto: '算兄弟姐妹时，被问到的那个人也要算进去。', howtoe: 'Include the person named in the count.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q2',
      q: '三个小朋友艾美、宾利和云妮各有一只宠物：猫、狗或兔。艾美养的不是猫，宾利养的是兔子，云妮养的是什么？', qy: '三个小朋友艾美、宾利同云妮各有一只宠物：猫、狗或者兔。艾美养嘅唔系猫，宾利养嘅系兔，云妮养嘅系咩？', qe: 'Amy, Benny and Winnie each have one pet: cat, dog or bunny. Amy does not have the cat, Benny has the bunny. What does Winnie have?',
      a: '猫', ans: 'choice', opts: ['猫', '狗', '兔'], optse: ['cat', 'dog', 'bunny'],
      hint: '宾利用了兔，剩下的猫和狗里艾美不是猫。', hinty: '宾利用咗兔，剩返猫同狗，艾美唔系猫。', hinte: 'Benny took the bunny; Amy is not the cat among the rest.',
      exp: '宾利是兔，艾美只能是狗，所以云妮是猫。', expe: 'Benny has the bunny, Amy must have the dog, so Winnie has the cat.',
      howto: '排除法：先填确定的，再按否定条件逐个排除。', howtoe: 'Elimination: fill what is certain, then rule out by the negative clues.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q3',
      q: '要把一个蛋糕切成 4 份，最少要切几刀？', qy: '要将一个蛋糕切成 4 份，最少要切幾多刀？', qe: 'What is the fewest cuts to divide a cake into 4 parts?',
      a: '2', ans: 'num',
      hint: '两刀交叉切。', hinty: '两刀交叉切。', hinte: 'Two crossing cuts.',
      exp: '横一刀竖一刀交叉，就得到 4 块，所以 2 刀。', expe: 'One cut across and one down the middle gives 4 pieces: 2 cuts.',
      howto: '刀痕交叉才能翻倍：2 刀出 4 块，3 刀出 6 到 7 块。', howtoe: 'Crossing cuts multiply the pieces.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q4',
      q: '约翰写了一个两位数。猜 16 时约翰说「有一个数字对，但位置错了」；猜 67 时也是同样回答。这个数是多少？', qy: '约翰写咗一个两位数。猜 16 时约翰话「有一个数字啱，但位置错」；猜 67 时都系同样答法。呢个数系几多？', qe: 'John wrote a 2-digit number. Guessing 16 gets \'one digit right but in the wrong place\'; guessing 67 gets the same reply. What is the number?',
      a: '71', ans: 'num',
      hint: '6 在 16 里是个位、在 67 里是十位，两次都说位置错。', hinty: '6 喺 16 里面系个位、喺 67 里面系十位，两次都话位置错。', hinte: '6 sits in the units place in 16 and in the tens place in 67, misplaced both times.',
      exp: '6 既不是个位也不是十位，说明 6 不在这个数里。16 剩下 1 在错位置，67 剩下 7 在错位置，所以是 71。', expe: '6 is neither digit, so it is not in the number. From 16 only 1 remains; from 67 only 7. Swapping gives 71.',
      howto: '「有数字对但位置错」要逐位排除，把每次猜的数字与位置记下来划掉。', howtoe: 'Track each guessed digit and its position; misplaced digits are present but not at that spot.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q5',
      q: '按规律：第 1 组 1 个圆，第 2 组 4 个圆，第 3 组 9 个圆。第 4 组有多少个圆？', qy: '跟规律：第 1 组 1 个圆，第 2 组 4 个圆，第 3 组 9 个圆。第 4 组有几多个圆？', qe: 'Group 1 has 1 circle, group 2 has 4, group 3 has 9. How many in group 4?',
      a: '16', ans: 'num',
      hint: '1、4、9 是 1 乘 1、2 乘 2、3 乘 3。', hinty: '1、4、9 系 1 乘 1、2 乘 2、3 乘 3。', hinte: '1, 4, 9 are 1×1, 2×2, 3×3.',
      exp: '第 4 组是 4 乘 4 等于 16。', expe: 'Group 4 is 4 × 4 = 16.',
      howto: '1、4、9、16 这种数是平方数，第几组就是几乘几。', howtoe: '1, 4, 9, 16 are square numbers: group n has n × n.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q6',
      q: '3 连加 10 次，等于多少？', qy: '3 连加 10 次，等于几多？', qe: 'What is 3 added ten times?',
      a: '30', ans: 'num',
      hint: '3 乘 10。', hinty: '3 乘 10。', hinte: '3 × 10.',
      exp: '3 乘 10 等于 30。', expe: '3 × 10 = 30.',
      howto: '相同的数连加就用乘法：个数乘这个数。', howtoe: 'Repeated equal additions are multiplication.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q7',
      q: '82 减 19 再减 42 等于多少？', qy: '82 减 19 再减 42 等于几多？', qe: 'What is 82 − 19 − 42?',
      a: '21', ans: 'num',
      hint: '先算 82 减 19。', hinty: '先算 82 减 19。', hinte: 'Start with 82 − 19.',
      exp: '82 减 19 等于 63，63 减 42 等于 21。', expe: '82 − 19 = 63, then 63 − 42 = 21.',
      howto: '连减分步算，算完用加法验算。', howtoe: 'Subtract in steps and check by adding back.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q8',
      q: '22 加多少等于 30？', qy: '22 加幾多等于 30？', qe: 'What plus 22 makes 30?',
      a: '8', ans: 'num',
      hint: '30 减 22。', hinty: '30 减 22。', hinte: '30 − 22.',
      exp: '30 减 22 等于 8。', expe: '30 − 22 = 8.',
      howto: '求加数用减法，再验算。', howtoe: 'Find the addend by subtraction, then check.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q9',
      q: '1 加 2 加 3 一直加到 11，等于多少？', qy: '1 加 2 加 3 一直加到 11，等于几多？', qe: 'What is 1 + 2 + 3 + ... + 11?',
      a: '66', ans: 'num',
      hint: '1 加 11、2 加 10 这样配对，每对都是 12。', hinty: '1 加 11、2 加 10 咁样配对，每对都系 12。', hinte: 'Pair 1 + 11, 2 + 10; every pair gives 12.',
      exp: '配对后 5 对每对 12，共 60，中间剩 6，加起来 66。', expe: '5 pairs of 12 make 60, plus the middle 6: 66.',
      howto: '一长串连加先配对，第一个配最后一个，中间的那个单独加。', howtoe: 'Pair the ends; handle the middle term separately.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q10',
      q: 'A 和 B 都是一位数，18 减 A 等于 B。A 最大是多少？', qy: 'A 同 B 都系一位数，18 减 A 等于 B。A 最大系几多？', qe: 'A and B are both 1-digit numbers and 18 − A = B. What is the largest possible A?',
      a: '9', ans: 'num',
      hint: 'B 也要是一位数，所以 18 减 A 不能超过 9。', hinty: 'B 都要系一位数，所以 18 减 A 唔可以大过 9。', hinte: 'B must stay a single digit, so 18 − A must be at most 9.',
      exp: '18 减 9 等于 9，B 是一位数；减 8 会得到 10，不是一位数。所以 A 最大是 9。', expe: '18 − 9 = 9 works; 18 − 8 = 10 does not. So A = 9.',
      howto: '题目有两个条件（A、B 都是一位数），从边界值开始试。', howtoe: 'With two constraints, start testing from the boundary value.' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q11',
      q: '艾美有 10 个苹果，约翰有 4 个。要让两人一样多，艾美要给约翰多少个？', qy: '艾美有 10 个苹果，约翰有 4 个。要让两个人一样多，艾美要畀约翰幾多个？', qe: 'Amy has 10 apples and John has 4. How many must Amy give John so they are equal?',
      a: '3', ans: 'num',
      hint: '一共 14 个，一样多每人 7 个；约翰已有 4 个。', hinty: '一共 14 个，一样多每人 7 个；约翰已经有 4 个。', hinte: '14 in total means 7 each; John already has 4.',
      exp: '一共 14 个，每人 7 个，约翰还差 3 个，所以给 3 个。', expe: '14 in total means 7 each; John needs 3 more, so Amy gives 3.',
      howto: '先算总数和每人应得，再减去对方已有的数。', howtoe: 'Compute the fair share, then subtract what the other already has.' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q12',
      q: '在 1、8、5、4 之间填加号或减号，使 1 8 5 4 = 8 成立。第一个符号是加还是减？', qy: '喺 1、8、5、4 之间填加号或者减号，令 1 8 5 4 = 8 成立。第一个符号系加定减？', qe: 'Put + or − between 1, 8, 5, 4 so the result is 8. Is the first sign + or −?',
      a: '+', ans: 'choice', opts: ['+', '−'], optse: ['+', '−'],
      hint: '1 加 8 减 5 加 4 等于多少？', hinty: '1 加 8 减 5 加 4 等于几多？', hinte: 'What is 1 + 8 − 5 + 4?',
      exp: '1 加 8 减 5 加 4 等于 8，所以第一个是加号。', expe: '1 + 8 − 5 + 4 = 8, so the first sign is +.',
      howto: '先全加得到 18，比目标多 10，把 5 换成减号正好少 10。', howtoe: 'All plus gives 18; switching the 5 to minus drops it by 10.' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q13',
      q: '四个小孩一共有 11 个气球，每人数量都不同，而且每人至少 1 个。气球最多的那个有多少个？', qy: '四个细路一共有 11 个气球，每人数量都唔同，而且每人至少有 1 个。气球最多嘅嗰个有幾多个？', qe: 'Four children share 11 balloons, all different amounts, at least one each. How many does the child with the most have?',
      a: '5', ans: 'num',
      hint: '另外三人尽量少：1、2、3。', hinty: '另外三人尽量少：1、2、3。', hinte: 'Give the other three as few as possible: 1, 2, 3.',
      exp: '另外三人最少 1 加 2 加 3 等于 6，剩下 11 减 6 等于 5。', expe: 'The other three take at least 6, leaving 11 − 6 = 5.',
      howto: '要让一个人最多，其他人尽量少，而且每人不同就取 1、2、3。', howtoe: 'Maximise one share by minimising the others while keeping them different.' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q14',
      q: '判断 2 加 5 加 8 加 11 加 14 加 17 加 20 加 23 的结果是奇数还是偶数？', qy: '判断 2 加 5 加 8 加 11 加 14 加 17 加 20 加 23 嘅结果系奇数定偶数？', qe: 'Is 2 + 5 + 8 + 11 + 14 + 17 + 20 + 23 odd or even?',
      a: '偶数', ans: 'choice', opts: ['奇数', '偶数'], optse: ['odd', 'even'],
      hint: '先数一数有几个奇数。', hinty: '先数下有几多个奇数。', hinte: 'Count how many of the numbers are odd.',
      exp: '5、11、17、23 共 4 个奇数，4 个奇数的和是偶数，所以整个结果是偶数（等于 100）。', expe: 'There are 4 odd numbers; the sum of an even count of odd numbers is even. The total is 100.',
      howto: '连加判单双不用全算：数一数奇数有几个，奇数个数是奇数结果就是奇数。', howtoe: 'To test parity of a sum, count the odd terms; an odd count gives an odd sum.' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q15',
      q: '有多少个两位数的个位数是 6？', qy: '有几多个两位数嘅个位数系 6？', qe: 'How many two-digit numbers have units digit 6?',
      a: '9', ans: 'num',
      hint: '16、26、36 一直到 96。', hinty: '16、26、36 一直到 96。', hinte: '16, 26, 36 up to 96.',
      exp: '16、26、36、46、56、66、76、86、96，一共 9 个。', expe: '16 to 96 step 10: 9 numbers.',
      howto: '十位可以是 1 到 9，共 9 种。', howtoe: 'The tens digit can be 1 to 9: nine choices.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2018-Primary-1 Q16',
      q: '一个正方形被分成 2 行 2 列的 4 个小正方形。图中一共有多少个正方形（大小都算）？', qy: '一个正方形分成 2 行 2 列嘅 4 个细正方形。图中一共有幾多个正方形（大细都计）？', qe: 'A square is cut into 2 rows and 2 columns. How many squares in total?',
      a: '5', ans: 'num',
      hint: '4 个小正方形加 1 个大的。', hinty: '4 个细正方形加 1 个大嘅。', hinte: '4 small squares plus the big one.',
      exp: '4 加 1 等于 5。', expe: '4 + 1 = 5.',
      howto: '数图形按大小分类，别漏掉大的。', howtoe: 'Count by size, including the large one.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2018-Primary-1 Q17',
      q: '一堆立方体：上面 2 个，下面 4 个。最少由多少个立方体组成？', qy: '一堆立方体：上面 2 个，下面 4 个。最少由幾多个立方体组成？', qe: 'A stack of cubes: 2 on top, 4 below. At least how many cubes?',
      a: '6', ans: 'num',
      hint: '按层加起来。', hinty: '按层加埋。', hinte: 'Add layer by layer.',
      exp: '2 加 4 等于 6。', expe: '2 + 4 = 6.',
      howto: '按层数，被挡住的也要算。', howtoe: 'Count by layer, hidden cubes included.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2018-Primary-1 Q18',
      q: '一个三角形被一条线分成 2 个小三角形。图中一共有多少个三角形（大小都算）？', qy: '一个三角形被一条线分成 2 个细三角形。图中一共有幾多个三角形（大细都计）？', qe: 'A triangle is split by one line into 2 small triangles. How many triangles in total?',
      a: '3', ans: 'num',
      hint: '2 个小的加上原来那个大的。', hinty: '2 个细嘅加埋原来嗰个大嘅。', hinte: '2 small ones plus the original large one.',
      exp: '2 加 1 等于 3。', expe: '2 + 1 = 3.',
      howto: '数图形按大小分类，别只数小的。', howtoe: 'Count by size, not only the small ones.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2018-Primary-1 Q19',
      q: '下面五个图案中，哪一个和其他四个不相似？规律是：相似的图案都是同一个图形旋转得到，不相似的形状不一样。', qy: '下面五个图案之中，边一个同其他四个唔相似？规律系：相似嘅图案都系同一个图形转出嚟，唔相似嘅形状唔同。', qe: 'Which of the five shapes is not similar to the others? Similar shapes are the same figure rotated; the odd one has a different shape.',
      a: 'E', ans: 'choice', opts: ['A', 'B', 'C', 'D', 'E'],
      hint: '相似只看形状，不管转了几多度。', hinty: '相似只睇形状，唔理转咗幾多度。', hinte: 'Similarity is about shape only, not rotation.',
      exp: 'A 到 D 都是同一个三角形转过来，E 是五边形，不是同一个形状，所以选 E。', expe: 'A to D are the same triangle rotated; E is a pentagon, so the answer is E.',
      howto: '判相似先把每个图形在纸上转一转，看能不能和别的重合。', howtoe: 'Mentally rotate each shape and see which ones coincide.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2018-Primary-1 Q20',
      q: '按规律：圆、方、三角、圆、圆、方、三角、圆、__、方、三角。空格是什么？', qy: '跟规律：圆、方、三角、圆、圆、方、三角、圆、__、方、三角。空格系咩？', qe: 'Pattern: circle, square, triangle, circle, circle, square, triangle, circle, __, square, triangle. What fills the blank?',
      a: '圆', ans: 'choice', opts: ['圆', '方', '三角'], optse: ['circle', 'square', 'triangle'],
      hint: '四个一循环：圆、方、三角、圆。', hinty: '四个一循环：圆、方、三角、圆。', hinte: 'The block is four long: circle, square, triangle, circle.',
      exp: '前面是「圆、方、三角、圆」为一组，第 9 个位置正好是这一组的最后一个，也就是圆。', expe: 'The block is circle, square, triangle, circle; position 9 is the fourth of the block: circle.',
      howto: '先数出一组有几多个，再算目标位置落在第几个。', howtoe: 'Count the block length, then locate the position in the block.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q21',
      q: '把 10 分成两个一位数相加，有多少种方法？（5+6 和 6+5 算同一种）', qy: '将 10 分成两个一位数相加，有幾多种方法？（5+6 同 6+5 当同一种）', qe: 'Split 10 into two 1-digit numbers. How many ways? (5+6 and 6+5 count as one.)',
      a: '5', ans: 'num',
      hint: '从 1+9 开始，一个一个数。', hinty: '由 1+9 开始，一个一个数。', hinte: 'Start from 1+9 and count one by one.',
      expe: '1 + 9, 2 + 8, 3 + 7, 4 + 6 and 5 + 5 make 5 ways.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q22',
      q: '从 1、3、5、8 里选 2 个不重复的数字组成两位数，能组成多少个奇数？', qy: '由 1、3、5、8 里面拣 2 个唔重复嘅数字组成两位数，可以组成幾多个奇数？', qe: 'From 1, 3, 5, 8 pick 2 digits without repeating to make a two-digit number. How many are odd?',
      a: '9', ans: 'num',
      hint: '奇数只看个位：1、3、5 都可以做个位。', hinty: '奇数只睇个位：1、3、5 都可以做个位。', hinte: 'Odd depends on the units digit: 1, 3 or 5.',
      exp: '个位 3 种选法（1、3、5），每种十位还剩 3 个数字可选，3 乘 3 等于 9。', expe: '3 odd units digits × 3 remaining tens digits = 9.',
      howto: '分位置想：个位决定奇偶，十位不能是 0；两位可选数相乘。', howtoe: 'Think by place value; multiply the choices for each place.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q23',
      q: '从学校到车站有 3 条路，从车站到图书馆有 2 条路。经车站从学校到图书馆有多少种走法？', qy: '由学校去车站有 3 条路，由车站去图书馆有 2 条路。经车站由学校去图书馆有幾多种走法？', qe: 'There are 3 ways from school to the station and 2 from the station to the library. How many ways via the station?',
      a: '6', ans: 'num',
      hint: '第一段每一种都配上第二段的每一种。', hinty: '第一段每一种都配第二段每一种。', hinte: 'Each first-leg choice pairs with each second-leg choice.',
      exp: '3 乘 2 等于 6 种。', expe: '3 × 2 = 6 ways.',
      howto: '分段走的走法数用乘法：第一段数量乘第二段数量。', howtoe: 'For staged trips, multiply the number of choices per stage.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q24',
      q: '最大的一位偶数和最小的两位奇数加起来是多少？', qy: '最大嘅一位偶数同最细嘅两位奇数加埋系几多？', qe: 'Add the greatest 1-digit even number and the smallest 2-digit odd number.',
      a: '19', ans: 'num',
      hint: '最大的一位偶数是 8，最小的两位奇数是 11。', hinty: '最大嘅一位偶数系 8，最细嘅两位奇数系 11。', hinte: 'Greatest 1-digit even is 8; smallest 2-digit odd is 11.',
      expe: 'The greatest 1-digit even number is 8 and the smallest 2-digit odd number is 11, so 8 + 11 = 19.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q25',
      q: '彼得有 12 枚 1 元硬币，能换多少个 2 元硬币？', qy: '彼得有 12 个 1 蚊，可以换幾多个 2 蚊？', qe: 'Peter has 12 one-dollar coins. How many two-dollar coins can he exchange them for?',
      a: '6', ans: 'num',
      hint: '每 2 个 1 元换 1 个 2 元。', hinty: '每 2 个 1 蚊换 1 个 2 蚊。', hinte: 'Two 1-dollar coins make one 2-dollar coin.',
      expe: '12 ÷ 2 = 6.',
    },

    /* ---------- TIMO-2020-2021-mock-Primary-1 ---------- */
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q1',
      q: '玛丽有一个哥哥和三个妹妹，玛丽的哥哥有几个妹妹？', qy: '玛丽有一个阿哥同三个细妹，玛丽个阿哥有幾多个细妹？', qe: 'Mary has one elder brother and three younger sisters. How many sisters does Mary\'s brother have?',
      a: '4', ans: 'num',
      hint: '玛丽自己也是妹妹。', hinty: '玛丽自己都系妹妹。', hinte: 'Mary herself is also a sister.',
      expe: 'Three sisters plus Mary herself makes 4 sisters for the brother.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q2',
      q: '艾美、宾利、云妮各有一只宠物：猫、狗或兔。艾美养的不是猫，宾利养的是兔子，云妮养的是什么？', qy: '艾美、宾利、云妮各有一只宠物：猫、狗或者兔。艾美养嘅唔系猫，宾利养嘅系兔，云妮养嘅系咩？', qe: 'Amy, Benny and Winnie each have a cat, a dog or a bunny. Amy does not have a cat, Benny has a bunny. What does Winnie have?',
      a: '猫', ans: 'choice', opts: ['猫', '狗', '兔'], optse: ['cat', 'dog', 'bunny'],
      hint: '宾利占了兔，剩下猫和狗。', hinty: '宾利要咗兔，剩低猫同狗。', hinte: 'Benny has the bunny. Cat and dog are left.',
      expe: 'Benny has the bunny. Amy is not the cat, so Amy has the dog and Winnie has the cat.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q3',
      q: '要把一个蛋糕切成 4 份，最少要切几刀？', qy: '要将一个蛋糕切成 4 份，最少要切幾多刀？', qe: 'At least how many cuts are needed to cut a cake into 4 parts?',
      a: '2', ans: 'num',
      hint: '一刀切两半，两刀呢？', hinty: '一刀切两半，两刀呢？', hinte: 'One cut makes two halves. What about two cuts?',
      expe: 'Two crossing cuts make 4 parts.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q4',
      q: '约翰写了一个两位数。彼得问「是 16 吗？」，约翰说「有一个数字对，但位置错了」。彼得再问「是 67 吗？」，约翰说「有一个数字对，但位置错了」。这个数是多少？', qy: '约翰写咗一个两位数。彼得问「系 16 咩？」，约翰话「有一个数字啱，但位置错咗」。彼得再问「系 67 咩？」，约翰话「有一个数字啱，但位置错咗」。呢个数系几多？', qe: 'John wrote a 2-digit number. For 16: "one digit is right but in the wrong place." For 67: same answer. What is the number?',
      a: '71', ans: 'num',
      hint: '16 里有 1 或 6；67 里有 6 或 7。共同的那个数字不能在自己的位置上。', hinty: '16 里面有 1 或者 6；67 里面有 6 或者 7。共同嗰个数字唔可以喺自己位置。', hinte: 'The shared digit must be in the other place.',
      expe: 'Take the 1 from 16 into the units place and the 7 from 67 into the tens place: 71 fits both hints.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q5',
      q: '按规律：第 1 组 1 个圆，第 2 组 4 个圆，第 3 组 9 个圆。第 4 组有多少个圆？', qy: '跟规律：第 1 组 1 个圆，第 2 组 4 个圆，第 3 组 9 个圆。第 4 组有幾多个圆？', qe: 'Group 1 has 1 circle, group 2 has 4, group 3 has 9. How many in group 4?',
      a: '16', ans: 'num',
      hint: '1、4、9 分别是几个自己相乘？', hinty: '1、4、9 分别系几个自己乘自己？', hinte: '1, 4, 9 are squares. What is the next square?',
      expe: '1 × 1, 2 × 2, 3 × 3, so group 4 has 4 × 4 = 16 circles.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q6',
      q: '3 连加 10 次，等于多少？', qy: '3 连加 10 次，等于几多？', qe: 'What is 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3?',
      a: '30', ans: 'num',
      hint: '10 个 3 是多少？', hinty: '10 个 3 系几多？', hinte: 'What is ten 3s?',
      expe: '3 × 10 = 30.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q7',
      q: '82 减 19 再减 42 等于多少？', qy: '82 减 19 再减 42 等于几多？', qe: 'What is 82 − 19 − 42?',
      a: '21', ans: 'num',
      hint: '82 减 42 是多少？', hinty: '82 减 42 系几多？', hinte: 'What is 82 − 42?',
      expe: '82 − 42 = 40, then 40 − 19 = 21.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q8',
      q: '22 加多少等于 30？', qy: '22 加幾多等于 30？', qe: '22 + ___ = 30. What number fills the blank?',
      a: '8', ans: 'num',
      hint: '30 减 22。', hinty: '30 减 22。', hinte: 'Do 30 − 22.',
      expe: '30 − 22 = 8.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q9',
      q: '1 加 2 加 3 加 4 加 5 加 6 加 7 加 8 加 9 加 10 加 11 等于多少？', qy: '1 加 2 加 3 加 4 加 5 加 6 加 7 加 8 加 9 加 10 加 11 等于几多？', qe: 'What is 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11?',
      a: '66', ans: 'num',
      hint: '1+10、2+9、3+8……这样配对。', hinty: '1+10、2+9、3+8……咁样配对。', hinte: 'Pair them: 1+10, 2+9, 3+8...',
      expe: '1 + 2 + ... + 10 = 55, plus 11 makes 66.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q10',
      q: 'A 和 B 都是一位数，18 减 A 等于 B，A 是多少？（答案页给 9）', qy: 'A 同 B 都系一位数，18 减 A 等于 B，A 系几多？（答案页畀 9）', qe: 'A and B are 1-digit numbers and 18 − A = B. What is A?',
      a: '9', ans: 'num',
      hint: '18 减几多会得到一位数？', hinty: '18 减幾多会得到一位数？', hinte: '18 minus what gives a single digit?',
      expe: 'A is one digit, so the largest is 9: 18 − 9 = 9 and A = B = 9.',
    },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q11',
      q: '艾美有 10 个苹果，约翰有 4 个。要让两人一样多，艾美要给约翰多少个？', qy: '艾美有 10 个苹果，约翰有 4 个。要让两个人一样多，艾美要畀约翰幾多个？', qe: 'Amy has 10 apples and John has 4. How many must Amy give John so they are equal?',
      a: '3', ans: 'num',
      hint: '一共 14 个，一样多每人几个？', hinty: '一共 14 个，一样多每人幾多个？', hinte: 'There are 14 in total. If equal, how many each?',
      expe: 'There are 14 apples, so 7 each. John already has 4, so Amy gives him 3.',
    },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q12',
      q: '在 1、3、5、7 之间填加号或减号，使 1 3 5 7 = 6 成立。第一个符号是加还是减？（本卷 Q12 与原卷结构同型）', qy: '喺 1、3、5、7 之间填加号或者减号，令 1 3 5 7 = 6 成立。第一个符号系加定减？', qe: 'Put + or − between 1, 3, 5, 7 so the result is 6. Is the first sign + or −?',
      a: '+', ans: 'choice', opts: ['+', '−'], optse: ['+', '−'],
      hint: '先全加得到 16，比 6 大 10。', hinty: '先全加得到 16，比 6 大 10。', hinte: 'All plus gives 16, ten too many.',
      exp: '1 加 3 减 5 加 7 等于 6，所以第一个是加号。', expe: '1 + 3 − 5 + 7 = 6, so the first sign is +.',
      howto: '换成减号会让结果少两倍那个数，按差值选要换的数。', howtoe: 'Switching to minus lowers the total by twice that number.' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q13',
      q: '四个小孩一共有 11 个气球，每人数量都不同，而且每人至少 1 个。气球最多的那个有多少个？', qy: '四个细路一共有 11 个气球，每人数量都唔同，而且每人至少有 1 个。气球最多嘅嗰个有幾多个？', qe: 'Four children have 11 balloons in total, all different, at least one each. How many does the one with most have?',
      a: '5', ans: 'num',
      hint: '先给三个人尽量少：1、2、3。', hinty: '先畀三个人尽量少：1、2、3。', hinte: 'Give the others as few as possible: 1, 2, 3.',
      expe: 'Give the other three as few as possible: 1 + 2 + 3 = 6, leaving 5 for the fourth child.',
    },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q14',
      q: '个位数是 0 的两位数有多少个？', qy: '个位数系 0 嘅两位数有幾多个？', qe: 'How many two-digit numbers end in 0?',
      a: '9', ans: 'num',
      hint: '十位可以是 1 到 9。', hinty: '十位可以系 1 到 9。', hinte: 'The tens digit can be 1 to 9.',
      expe: '10, 20, 30, 40, 50, 60, 70, 80 and 90 make 9 numbers.',
    },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q15',
      q: '按规律：1、4、7、10、13，下一个是多少？', qy: '跟规律：1、4、7、10、13，下一个系几多？', qe: 'Pattern: 1, 4, 7, 10, 13. What comes next?',
      a: '16', ans: 'num',
      hint: '每次加了多少？', hinty: '每次加咗幾多？', hinte: 'How much is added each time?',
      expe: 'Each term adds 3, so 13 + 3 = 16.',
    },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q16',
      q: '一个正方形被分成 2 行 2 列的 4 个小正方形。图中一共有多少个正方形（大小都算）？', qy: '一个正方形分成 2 行 2 列嘅 4 个细正方形。图中一共有幾多个正方形（大细都计）？', qe: 'A square is cut into 2 rows and 2 columns. How many squares in total?',
      a: '5', ans: 'num',
      hint: '4 个小的加 1 个大的。', hinty: '4 个细嘅加 1 个大嘅。', hinte: '4 small plus 1 big.',
      exp: '4 加 1 等于 5。', expe: '4 + 1 = 5.',
      howto: '按大小分类数。', howtoe: 'Count by size.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q17',
      q: '一堆立方体：上面 2 个，下面 4 个。最少由多少个立方体组成？', qy: '一堆立方体：上面 2 个，下面 4 个。最少由幾多个立方体组成？', qe: 'A stack of cubes: 2 on top, 4 below. At least how many cubes?',
      a: '6', ans: 'num',
      hint: '按层加起来。', hinty: '按层加埋。', hinte: 'Add layer by layer.',
      exp: '2 加 4 等于 6。', expe: '2 + 4 = 6.',
      howto: '按层数，被挡住的那块也要算。', howtoe: 'Count by layer; hidden cubes count too.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q18',
      q: '一个三角形被一条线分成 2 个小三角形。图中一共有多少个三角形（大小都算）？', qy: '一个三角形被一条线分成 2 个细三角形。图中一共有幾多个三角形（大细都计）？', qe: 'A triangle is split by one line into 2 small triangles. How many triangles in total?',
      a: '3', ans: 'num',
      hint: '2 个小的加原来那个大的。', hinty: '2 个细嘅加原来嗰个大嘅。', hinte: '2 small plus the original big one.',
      exp: '2 加 1 等于 3。', expe: '2 + 1 = 3.',
      howto: '按大小分类数。', howtoe: 'Count by size.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q19',
      q: '下面五个图案中，哪一个和其他的不相似？相似的图案是同一个图形旋转得到。', qy: '下面五个图案之中，边一个同其他唔相似？相似嘅图案系同一个图形转出嚟。', qe: 'Which of the five shapes is not similar to the others? Similar ones are the same figure rotated.',
      a: 'E', ans: 'choice', opts: ['A', 'B', 'C', 'D', 'E'],
      hint: '相似只看形状，不看转了几多度。', hinty: '相似只睇形状，唔睇转咗幾多度。', hinte: 'Similarity is about shape only.',
      exp: 'A 到 D 是同一个三角形转过来，E 是五边形，所以选 E。', expe: 'A to D are the same triangle rotated; E is a pentagon, so E.',
      howto: '在心里把图形转一转，看能不能和别的重合。', howtoe: 'Mentally rotate each shape to see which ones coincide.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q20',
      q: '按规律：圆、方、三角、圆、圆、方、三角、圆、__、方、三角。空格是什么？', qy: '跟规律：圆、方、三角、圆、圆、方、三角、圆、__、方、三角。空格系咩？', qe: 'Pattern: circle, square, triangle, circle, circle, square, triangle, circle, __, square, triangle. What fills the blank?',
      a: '圆', ans: 'choice', opts: ['圆', '方', '三角'], optse: ['circle', 'square', 'triangle'],
      hint: '四个一循环：圆、方、三角、圆。', hinty: '四个一循环：圆、方、三角、圆。', hinte: 'The block is four long: circle, square, triangle, circle.',
      exp: '第 9 个位置是这一组的最后一个，也就是圆。', expe: 'Position 9 is the last of the block: circle.',
      howto: '先数一组几个，再算目标位置落在第几个。', howtoe: 'Count the block length, then locate the position.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q21',
      q: '把 8 粒糖果分成一样多的两份，每份多少粒？', qy: '将 8 粒糖分成一样多嘅两份，每份幾多粒？', qe: 'Split 8 candies into two equal groups. How many in each?',
      a: '4', ans: 'num',
      hint: '一半是多少？', hinty: '一半系幾多？', hinte: 'What is half of 8?',
      expe: 'Half of 8 is 4.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q22',
      q: '从 1、3、5、8 里选 2 个不重复的数字组成两位数，能组成多少个奇数？', qy: '从 1、3、5、8 里面拣 2 个唔重复嘅数字组成两位数，可以组成幾多个奇数？', qe: 'From 1, 3, 5, 8 pick 2 digits without repeating to make two-digit numbers. How many are odd?',
      a: '9', ans: 'num',
      hint: '奇数要个位是 1、3、5。', hinty: '奇数要个位系 1、3、5。', hinte: 'Odd numbers need units digit 1, 3 or 5.',
      expe: 'The units digit is 1, 3 or 5 and the tens digit has 3 choices each, so 3 × 3 = 9 odd numbers.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q23',
      q: '从学校到车站有 3 条路，从车站到图书馆有 2 条路。经车站从学校到图书馆有多少种走法？', qy: '由学校去车站有 3 条路，由车站去图书馆有 2 条路。经车站由学校去图书馆有幾多种走法？', qe: 'There are 3 ways from school to the station and 2 from the station to the library. How many ways from school to the library via the station?',
      a: '6', ans: 'num',
      hint: '每一段都配一次。', hinty: '每一段都配一次。', hinte: 'Each first-leg choice pairs with each second-leg choice.',
      expe: '3 × 2 = 6 ways.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q24',
      q: '用 3、6、1、8 各用一次，组成最小的四位数是多少？', qy: '用 3、6、1、8 每个用一次，组成最细嘅四位数系几多？', qe: 'Use 3, 6, 1, 8 once each to make the smallest 4-digit number.',
      a: '1368', ans: 'num',
      hint: '最小的数字放千位。', hinty: '最细嘅数字放千位。', hinte: 'Put the smallest digit first.',
      expe: 'Put the digits from smallest to largest: 1368.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q25',
      q: '从 0、3、5、6、9 里选 2 个不重复的数字组成两位数，能组成多少个 5 的倍数？', qy: '从 0、3、5、6、9 里面拣 2 个唔重复嘅数字组成两位数，可以组成幾多个 5 嘅倍数？', qe: 'From 0, 3, 5, 6, 9 pick 2 digits without repeating to make two-digit multiples of 5. How many?',
      a: '7', ans: 'num',
      hint: '5 的倍数个位是 0 或 5；十位不能是 0。', hinty: '5 嘅倍数个位系 0 或者 5；十位唔可以系 0。', hinte: 'Multiples of 5 end in 0 or 5; the tens digit cannot be 0.',
      expe: 'Ending in 0: 30, 50, 60, 90 (4); ending in 5: 35, 65, 95 (3); so 7 multiples.',
    }

  ];

  /* ===== 反背题：动态出题模板（owner 2026-11-19「要做反背题」） =====
   * 数字由 rng 现场生成、答案当场算出来：孩子记住「上次答案是 13」没有用，
   * 同一模板下一次换一组数，答案跟着变。pick() 每轮先用生成题（约 3/4），
   * 并避开最近 200 道出过的题面（localStorage），原卷题库只用来补位、留出处。
   * 复练走 variant()：错题不是原题重来，而是同型换数据的新题。
   */
  const RND = (lo, hi, rng) => lo + Math.floor((rng || Math.random)() * (hi - lo + 1));
  const fp = q => String((q && q.qe) || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const SEEN_KEY = 'timo_seen_v1', SEEN_MAX = 200;
  function loadSeen() { try { const a = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveSeen(list) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-SEEN_MAX))); } catch (e) {} }
  function noteSeen(list) { if (list.length) saveSeen(loadSeen().concat(list)); }
  function shuffled(a, rng) { const r = rng || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  /* 选择题正确项随机摆位：不能靠「每次都点第二个」蒙对 */
  function withCorrect(correct, others, rng) {
    const opts = others.slice(), at = Math.floor((rng || Math.random)() * (opts.length + 1));
    opts.splice(at, 0, correct);
    return opts;
  }
  const SEQ = (n, f, sep) => Array.from({ length: n }, (_, i) => f(i)).join(sep);

  const GEN = [
    /* ---------- K2 / 幼稚园组 ---------- */
    { id: 'k2-add3', lv: 'k2', sec: '算术', make(r) {
        const a = RND(2, 19, r), b = RND(2, 19, r), c = RND(2, 9, r), s1 = a + b, s = s1 + c;
        return { lv: 'k2', sec: '算术', src: 'gen:连加', ans: 'num', a: String(s),
          q: `${a} 加 ${b} 加 ${c} 等于多少？`, qy: `${a} 加 ${b} 加 ${c} 等于几多？`,
          qe: `What is ${a} + ${b} + ${c}?`,
          hint: `先算 ${a} 加 ${b}。`, hinty: `先算 ${a} 加 ${b}。`, hinte: `Start with ${a} + ${b}.`,
          exp: `${a} + ${b} = ${s1}，再 ${s1} + ${c} = ${s}。`, expe: `${a} + ${b} = ${s1}, then ${s1} + ${c} = ${s}.`,
          howto: `连加从左往右一步一步算，每步写下中间结果；不要跳步心算。`,
          howtoe: `Work left to right and write each step down; do not skip steps.` };
      } },
    { id: 'k2-sub2', lv: 'k2', sec: '算术', make(r) {
        const a = RND(12, 20, r), b = RND(2, 8, r), room = a - b;
        const c = RND(2, Math.max(2, Math.min(9, room - 1)), r), s1 = a - b, s = s1 - c;
        return { lv: 'k2', sec: '算术', src: 'gen:连减', ans: 'num', a: String(s),
          q: `${a} 减 ${b} 再减 ${c} 等于多少？`, qy: `${a} 减 ${b} 再减 ${c} 等于几多？`,
          qe: `What is ${a} − ${b} − ${c}?`,
          hint: `先算 ${a} 减 ${b}。`, hinty: `先算 ${a} 减 ${b}。`, hinte: `Start with ${a} − ${b}.`,
          exp: `${a} − ${b} = ${s1}，再 ${s1} − ${c} = ${s}。`, expe: `${a} − ${b} = ${s1}, then ${s1} − ${c} = ${s}.`,
          howto: `连减先算第一步，把得到的数再减第二个；可以用加法验算。`,
          howtoe: `Subtract step by step and check your answer by adding back.` };
      } },
    { id: 'k2-seq', lv: 'k2', sec: '逻辑', make(r) {
        const st = RND(1, 9, r), d = RND(2, 9, r), a = st + 5 * d;
        return { lv: 'k2', sec: '逻辑', src: 'gen:规律', ans: 'num', a: String(a),
          q: `按规律：${SEQ(5, i => st + i * d, '、')}，下一个是多少？`,
          qy: `跟规律：${SEQ(5, i => st + i * d, '、')}，下一个系几多？`,
          qe: `Pattern: ${SEQ(5, i => st + i * d, ', ')}. What comes next?`,
          hint: `看看每次加了多少。`, hinty: `睇下每次加咗幾多。`, hinte: 'How much is added each time?',
          exp: `每次都加 ${d}，${st + 4 * d} 加 ${d} 等于 ${a}。`, expe: `Each term adds ${d}: ${st + 4 * d} + ${d} = ${a}.`,
          howto: `规律题先算相邻两个数差多少，差固定就用这个差往下推。`,
          howtoe: `Work out the gap between neighbouring numbers; if it is constant, keep adding it.` };
      } },
    { id: 'k2-times', lv: 'k2', sec: '算术', make(r) {
        const m = RND(2, 5, r), n = RND(2, 6, r), a = m * n;
        return { lv: 'k2', sec: '算术', src: 'gen:几个几', ans: 'num', a: String(a),
          q: `${m} 个 ${n} 加起来是多少？`, qy: `${m} 个 ${n} 加起来系几多？`,
          qe: `What is ${n} added ${m} times?`,
          hint: `一个一个加：${n}、${n + n}……`, hinty: `一个一个加：${n}、${n + n}……`, hinte: `Add them one at a time: ${n}, ${n + n}, ...`,
          exp: `${Array(m).fill(n).join(' + ')} = ${a}，也就是 ${n} × ${m}。`, expe: `${Array(m).fill(n).join(' + ')} = ${a}, that is ${n} × ${m}.`,
          howto: `先一个一个加，再看一共加了几次；下次看到「几个几」直接想乘法。`,
          howtoe: `Add one at a time first, then count how many times you added; next time use multiplication straight away.` };
      } },
    /* 平均分/几个几的变体：分给人或分进盒子，数据全变 */
    { id: 'k2-share2', lv: 'k2', sec: '组合', make(r) {
        const m = RND(2, 5, r), k = RND(2, 8, r), total = m * k;
        const who = ['小朋友', '盒子', '袋子', '盘子'][RND(0, 3, r)];
        const whEn = { '小朋友': 'children', '盒子': 'boxes', '袋子': 'bags', '盘子': 'plates' }[who];
        return { lv: 'k2', sec: '组合', src: 'gen:平均分', ans: 'num', a: String(k),
          q: `${total} 个苹果平均放进 ${m} 个${who}，每个${who}放多少个？`, qy: `${total} 个苹果平均放入 ${m} 个${who}，每个${who}放幾多个？`,
          qe: `${total} apples are shared equally into ${m} ${whEn}. How many in each?`,
          hint: `${m} 乘多少会等于 ${total}？`, hinty: `${m} 乘幾多会等于 ${total}？`, hinte: `What times ${m} makes ${total}?`,
          exp: `${total} 除以 ${m} 等于 ${k}，每个${who}放 ${k} 个。`, expe: `${total} divided by ${m} is ${k}, so ${k} in each.`,
          howto: `平均分就是除法：总数除以份数；验算用乘法 ${k} × ${m} 应该回到 ${total}。`,
          howtoe: `Equal sharing is division: total divided by the number of groups. Check with ${k} × ${m} = ${total}.` };
      } },
    { id: 'k2-blank', lv: 'k2', sec: '算术', make(r) {
        const sum = RND(20, 50, r), a = RND(10, sum - 5, r), ans = sum - a;
        return { lv: 'k2', sec: '算术', src: 'gen:填空', ans: 'num', a: String(ans),
          q: `${a} 加多少等于 ${sum}？`, qy: `${a} 加幾多等于 ${sum}？`,
          qe: `${a} + ___ = ${sum}. What fills the blank?`,
          hint: `用 ${sum} 减 ${a}。`, hinty: `用 ${sum} 减 ${a}。`, hinte: `Do ${sum} − ${a}.`,
          exp: `${sum} − ${a} = ${ans}。`, expe: `${sum} − ${a} = ${ans}.`,
          howto: `求加数用减法：和减已知的那个数；算完把 ${ans} 加回 ${a} 验一下。`,
          howtoe: `Find the missing addend by subtraction: total minus the known part. Check by adding ${ans} + ${a}.` };
      } },
    { id: 'k2-more', lv: 'k2', sec: '数论', make(r) {
        const y = RND(2, 20, r), x = RND(y + 1, y + 15, r), ans = x - y;
        return { lv: 'k2', sec: '数论', src: 'gen:相差', ans: 'num', a: String(ans),
          q: `小明有 ${x} 个苹果，小红有 ${y} 个。小明比小红多多少个？`, qy: `小明有 ${x} 个苹果，小红有 ${y} 个。小明比小红多幾多个？`,
          qe: `Ming has ${x} apples and Ling has ${y}. How many more does Ming have?`,
          hint: `比多少用减法。`, hinty: `比幾多用减法。`, hinte: 'Compare with subtraction.',
          exp: `${x} − ${y} = ${ans}。`, expe: `${x} − ${y} = ${ans}.`,
          howto: `「比…多多少」就是大数减小数，不是把两个数加起来。`,
          howtoe: `How many more means the bigger minus the smaller, not adding them.` };
      } },
    { id: 'k2-biggest', lv: 'k2', sec: '数论', make(r) {
        const nums = shuffled([RND(1, 20, r), RND(21, 40, r), RND(41, 60, r)], r).map(String);
        const big = nums.slice().sort((x, y) => Number(y) - Number(x))[0];
        const opts = withCorrect(big, nums.filter(v => v !== big), r);
        return { lv: 'k2', sec: '数论', src: 'gen:比大小', ans: 'choice', opts, a: big,
          q: `哪一个小？`, qy: `边一个最细？`, qe: `Which number is the smallest?`,
          hint: `先看十位，十位一样再看个位。`, hinty: `先睇十位，十位一样再睇个位。`, hinte: 'Check the tens digit first.',
          exp: `${opts.slice().sort((x, y) => Number(x) - Number(y))[0]} 最小。`, expe: `${opts.slice().sort((x, y) => Number(x) - Number(y))[0]} is the smallest.`,
          howto: `比大小先比位数，位数一样从高位往下比，不用把它们加起来。`,
          howtoe: `Compare digit by digit from the left; you never need to add the numbers.` };
      } },
    /* 新的 K2 模板：图形规律 / 单双数 / 一半 / 时间顺序 */
    { id: 'k2-shapes', lv: 'k2', sec: '逻辑', make(r) {
        const set = shuffled(['红圆', '蓝三角', '黄方', '绿星'], r);
        const en = { '红圆': 'red circle', '蓝三角': 'blue triangle', '黄方': 'yellow square', '绿星': 'green star' };
        const a = set[3];
        return { lv: 'k2', sec: '逻辑', src: 'gen:图形规律', ans: 'choice',
          opts: shuffled([a, set[0], set[1]].slice(), r), a,
          q: `按规律：${set[0]}、${set[1]}、${set[0]}、${set[1]}，下一个是什么？`, qy: `跟规律：${set[0]}、${set[1]}、${set[0]}、${set[1]}，下一个系咩？`,
          qe: `Pattern: ${en[set[0]]}, ${en[set[1]]}, ${en[set[0]]}, ${en[set[1]]}. What comes next?`,
          hint: `看看前面两个是怎么排的。`, hinty: `睇下前面两个系点排嘅。`, hinte: 'Look at how the first two repeat.',
          exp: `规律是两个一循环，所以下一个回到第一个 ${set[0]}。`, expe: `The pattern repeats every two, so next is the first one: ${en[set[0]]}.`,
          howto: `找规律先找循环长度，再往后数一格。`, howtoe: `Find the repeating block first, then count one step forward.` };
      } },
    { id: 'k2-parity', lv: 'k2', sec: '数论', make(r) {
        const n = RND(11, 99, r), odd = n % 2 === 1;
        return { lv: 'k2', sec: '数论', src: 'gen:单双数', ans: 'choice', opts: ['单数', '双数'], a: odd ? '单数' : '双数',
          optse: ['odd', 'even'],
          q: `${n} 是单数还是双数？`, qy: `${n} 系单数定双数？`,
          qe: `Is ${n} odd or even?`,
          hint: `看个位：1、3、5、7、9 是单数。`, hinty: `睇个位：1、3、5、7、9 系单数。`, hinte: 'Look at the units digit: 1, 3, 5, 7, 9 mean odd.',
          exp: `${n} 的个位是 ${n % 10}，所以是${odd ? '单数' : '双数'}。`, expe: `The units digit of ${n} is ${n % 10}, so it is ${odd ? 'odd' : 'even'}.`,
          howto: `判断单双只看个位，不用算别的。`, howtoe: `Odd or even is decided by the units digit alone.` };
      } },
    { id: 'k2-half', lv: 'k2', sec: '算术', make(r) {
        const k = RND(2, 9, r), total = k * 2;
        return { lv: 'k2', sec: '算术', src: 'gen:一半', ans: 'num', a: String(k),
          q: `${total} 的一半是多少？`, qy: `${total} 嘅一半系幾多？`,
          qe: `What is half of ${total}?`,
          hint: `想：几多乘 2 等于 ${total}？`, hinty: `谂：幾多乘 2 等于 ${total}？`, hinte: `What times 2 makes ${total}?`,
          exp: `${total} ÷ 2 = ${k}。`, expe: `${total} ÷ 2 = ${k}.`,
          howto: `一半就是平均分两份，可以用乘法反推。`, howtoe: `Half means splitting into two equal parts; you can check with multiplication.` };
      } },

    /* ---------- P1 / 小一 ---------- */
    { id: 'p1-give', lv: 'p1', sec: '数论', make(r) {
        const b = RND(2, 12, r), d = RND(1, 8, r), a = b + 2 * d;
        return { lv: 'p1', sec: '数论', src: 'gen:给到一样多', ans: 'num', a: String(d),
          q: `艾美有 ${a} 个苹果，约翰有 ${b} 个。要让两人一样多，艾美要给约翰多少个？`, qy: `艾美有 ${a} 个苹果，约翰有 ${b} 个。要让两个人一样多，艾美要畀约翰幾多个？`,
          qe: `Amy has ${a} apples and John has ${b}. How many must Amy give John so they are equal?`,
          hint: `一共 ${a + b} 个，一样多每人几个？`, hinty: `一共 ${a + b} 个，一样多每人幾多个？`, hinte: `There are ${a + b} in total. How many each if equal?`,
          exp: `一共 ${a + b} 个，一样多每人 ${(a + b) / 2} 个；约翰已有 ${b} 个，所以给 ${d} 个。`, expe: `${a + b} in total means ${(a + b) / 2} each. John has ${b}, so Amy gives ${d}.`,
          howto: `求「给多少才一样多」：先算两人一共多少，再除以人数得每人多少，然后用已有数减一下；不是把差除以二就完事，要验算。`,
          howtoe: `For make-it-equal: total divided by the number of people, minus what the other one already has. Always check by giving and recounting.` };
      } },
    { id: 'p1-balloons', lv: 'p1', sec: '数论', make(r) {
        const total = RND(10, 20, r), ans = total - 6;
        return { lv: 'p1', sec: '数论', src: 'gen:最多最少', ans: 'num', a: String(ans),
          q: `四个小孩一共有 ${total} 个气球，每人数量都不同，而且每人至少 1 个。气球最多的那个有多少个？`, qy: `四个细路一共有 ${total} 个气球，每人数量都唔同，而且每人至少有 1 个。气球最多嘅嗰个有幾多个？`,
          qe: `Four children have ${total} balloons in total, all different amounts, at least one each. How many does the child with the most have?`,
          hint: `先给三个人尽量少：1、2、3。`, hinty: `先畀三个人尽量少：1、2、3。`, hinte: 'Give the other three as few as possible: 1, 2, 3.',
          exp: `另外三人最少是 1 + 2 + 3 = 6，剩下 ${total} − 6 = ${ans}。`, expe: `The other three take at least 1 + 2 + 3 = 6, so the fourth has ${total} − 6 = ${ans}.`,
          howto: `「最多那个最多多少」先让其他人尽量少：每人不同就取 1、2、3，剩下的全给最多的那个。`,
          howtoe: `To maximise one child's share, give the others as little as possible while keeping them different: 1, 2, 3.` };
      } },
    { id: 'p1-odd', lv: 'p1', sec: '组合', make(r) {
        const ds = shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], r).slice(0, 4);
        const o = ds.filter(v => v % 2 === 1).length;
        const tens = 3 - (ds.indexOf(0) >= 0 ? 1 : 0);   // 十位不能是 0
        const ans = o * tens;
        return { lv: 'p1', sec: '组合', src: 'gen:奇数个数', ans: 'num', a: String(ans),
          q: `从 ${ds.join('、')} 里选 2 个不重复的数字组成两位数，能组成多少个奇数？`, qy: `由 ${ds.join('、')} 里面拣 2 个唔重复嘅数字组成两位数，可以组成幾多个奇数？`,
          qe: `From ${ds.join(', ')} pick 2 digits without repeating to make two-digit numbers. How many are odd?`,
          hint: `先数个位可以是哪几个奇数。`, hinty: `先数个位可以系邊几个奇数。`, hinte: 'Count the odd digits first: those can be the units digit.',
          exp: o ? `个位有 ${o} 个奇数可选；十位剩下 ${tens} 个可选（不能是 0）→ ${o} × ${tens} = ${ans}。` : `四个数字都是偶数，个位凑不出奇数，所以是 0 个。`,
          expe: o ? `${o} odd digit(s) for the unit place, ${tens} digit(s) left for the tens place (0 cannot lead): ${o} × ${tens} = ${ans}.` : 'All four digits are even, so no odd number can be made: 0.',
          howto: `分位置想：个位决定奇偶，十位不能是 0；两位可选数相乘就是答案。`,
          howtoe: `Think by place value: the units digit decides odd or even, the tens digit cannot be zero.` };
      } },
    { id: 'p1-pairsum', lv: 'p1', sec: '算术', make(r) {
        const n = RND(8, 15, r), ans = n * (n + 1) / 2;
        return { lv: 'p1', sec: '算术', src: 'gen:连加配对', ans: 'num', a: String(ans),
          q: `1 加 2 一直加到 ${n}，等于多少？`, qy: `1 加 2 一直加到 ${n}，等于几多？`,
          qe: `What is 1 + 2 + 3 + ... + ${n}?`,
          hint: `1 加 ${n}、2 加 ${n - 1}……这样配对。`, hinty: `1 加 ${n}、2 加 ${n - 1}……咁样配对。`, hinte: `Pair them: 1 + ${n}, 2 + ${n - 1}, ...`,
          exp: `配对后每对都是 ${n + 1}，一共 ${ans}。`, expe: `Each pair adds to ${n + 1}, and the total is ${ans}.`,
          howto: `数个数要分位置：个位决定奇偶，十位不能是 0；两个位置的可选数相乘就是总数。`,
          howtoe: `Count by place: the units digit decides odd or even, and the tens digit cannot be zero; multiply the choices.` };
      } },
    { id: 'p1-smallest', lv: 'p1', sec: '组合', make(r) {
        const ds = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], r).slice(0, 4);
        const ans = ds.slice().sort((x, y) => x - y).join('');
        return { lv: 'p1', sec: '组合', src: 'gen:最细四位数', ans: 'num', a: ans,
          q: `用 ${ds.join('、')} 各用一次，组成最小的四位数是多少？`, qy: `用 ${ds.join('、')} 每个用一次，组成最细嘅四位数系几多？`,
          qe: `Use ${ds.join(', ')} once each to make the smallest 4-digit number.`,
          hint: `最小的数字放千位。`, hinty: `最细嘅数字放千位。`, hinte: 'Put the smallest digit first.',
          exp: `数字从小到大排：${ans}。`, expe: `Order the digits from smallest to largest: ${ans}.`,
          howto: `一长串连加先找配对：第一个配最后一个、第二个配倒数第二个，每对和一样，再数有多少对。`,
          howtoe: `For long sums, pair the ends: first with last, second with second last; each pair has the same total, then count the pairs.` };
      } },
    { id: 'p1-seqmul', lv: 'p1', sec: '逻辑', make(r) {
        const st = RND(1, 3, r), k = RND(2, 3, r), a = st * Math.pow(k, 4);
        return { lv: 'p1', sec: '逻辑', src: 'gen:倍数规律', ans: 'num', a: String(a),
          q: `按规律：${SEQ(4, i => st * Math.pow(k, i), '、')}，下一个是多少？`, qy: `跟规律：${SEQ(4, i => st * Math.pow(k, i), '、')}，下一个系几多？`,
          qe: `Pattern: ${SEQ(4, i => st * Math.pow(k, i), ', ')}. What comes next?`,
          hint: `看看每个数是前一个的几倍。`, hinty: `睇下每个数系前一个嘅幾倍。`, hinte: 'How many times bigger is each term?',
          exp: `每次都乘 ${k}，${st * Math.pow(k, 3)} 乘 ${k} 等于 ${a}。`, expe: `Each term is multiplied by ${k}: ${st * Math.pow(k, 3)} × ${k} = ${a}.`,
          howto: `组最小数就把数字从小到大排，注意 0 不能放最高位。`,
          howtoe: `For the smallest number, order the digits from small to large; zero can never be the leading digit.` };
      } },
    { id: 'p1-route', lv: 'p1', sec: '组合', make(r) {
        const m = RND(2, 5, r), n = RND(2, 4, r), a = m * n;
        return { lv: 'p1', sec: '组合', src: 'gen:走法', ans: 'num', a: String(a),
          q: `从学校到车站有 ${m} 条路，从车站到图书馆有 ${n} 条路。经车站从学校到图书馆有多少种走法？`, qy: `由学校去车站有 ${m} 条路，由车站去图书馆有 ${n} 条路。经车站由学校去图书馆有幾多种走法？`,
          qe: `There are ${m} ways from school to the station and ${n} from the station to the library. How many ways from school to the library via the station?`,
          hint: `每一段都配一次。`, hinty: `每一段都配一次。`, hinte: 'Every first-leg choice pairs with every second-leg choice.',
          exp: `${m} × ${n} = ${a} 种。`, expe: `${m} × ${n} = ${a} ways.`,
          howto: `规律题先看相邻两个数的差或倍数，找到规则再往下算一步。`,
          howtoe: `For patterns, look at the difference or the ratio between neighbouring terms, then apply it once.` };
      } },
    { id: 'p1-mult5', lv: 'p1', sec: '数论', make(r) {
        const good = String(5 * RND(3, 19, r));
        const others = [];
        while (others.length < 3) { const v = RND(11, 99, r); if (v % 5 && String(v) !== good && others.indexOf(String(v)) < 0) others.push(String(v)); }
        const opts = withCorrect(good, others, r);
        return { lv: 'p1', sec: '数论', src: 'gen:5 的倍数', ans: 'choice', opts, a: good,
          q: `下面哪一个是 5 的倍数？`, qy: `下面边一个系 5 的倍数？`, qe: `Which of these is a multiple of 5?`,
          hint: `5 的倍数个位一定是 0 或 5。`, hinty: `5 嘅倍数个位一定系 0 或者 5。`, hinte: 'A multiple of 5 always ends in 0 or 5.',
          exp: `${good} 的个位是 ${good.slice(-1)}，所以是 5 的倍数。`, expe: `${good} ends in ${good.slice(-1)}, so it is a multiple of 5.`,
          howto: `倍数先看个位：5 的倍数个位只能是 0 或 5，其他位不用算。`,
          howtoe: `Multiples of 5 always end in 0 or 5, so check the units digit only.` };
      } },
  ];

  /* 分档（页面上的按钮顺序） */
  /* 只留幼儿园(K2)与小一(P1)两档：TIMO 题面、数据、讲法都按这两个年级设计 */
  const LEVELS = [
    { id: 'k2', name: '幼稚园 K2', note: '幼儿园组：数字现场生成，考听懂题就会做',
      name_en: 'Kindergarten (K2)', note_en: 'TIMO Kindergarten level: numbers are generated fresh each round' },
    { id: 'p1', name: '小一 P1', note: '一年级：数字现场生成，答案当场算',
      name_en: 'Primary 1 (P1)', note_en: 'TIMO Primary 1 level: numbers are generated fresh each round' },
  ];

  /* 按档位出题（反背题 + 题型要匀，owner 2026-11-20「题目太单一、全是要数字的」）：
     ① 原卷 100 题全覆盖（4 卷 × 25 题），是主库；生成题只在原卷题做得重复时补位
     ② 一轮尽量覆盖不同题型（逻辑/算术/数论/几何/组合），并让选项题占一点比例
     ③ 避开最近 200 道出过的题面 */
  function pick(lv, n, rng) {
    const r = rng || Math.random;
    const count = Math.max(1, n || 8);
    const seen = loadSeen();
    const gens = GEN.filter(g => g.lv === lv);
    const out = [];
    const secUsed = {};
    // ① 原卷题：按题型轮转挑，同一轮尽量不落在同一个 sec 上
    const fresh = shuffled(BANK.filter(q => q.lv === lv && seen.indexOf(fp(q)) < 0).slice(), r);
    const bySec = {};
    for (const q of fresh) (bySec[q.sec] = bySec[q.sec] || []).push(q);
    const secs = Object.keys(bySec);
    let round = 0;
    while (out.length < count && round < 8 && secs.length) {
      for (const s of secs) {
        if (out.length >= count) break;
        const pool = bySec[s];
        const q = pool && pool.shift();
        if (q && !out.some(o => fp(o) === fp(q))) { out.push(shuffleOpts(q, r)); secUsed[s] = (secUsed[s] || 0) + 1; }
      }
      round++;
    }
    // ② 原卷题不够（一轮 8 题、一天十几轮）：用生成题补，也按没覆盖过的 sec 优先
    let guard = 0;
    while (out.length < count && gens.length && guard++ < 600) {
      const cands = gens.filter(g => secUsed[g.sec] < 2);
      const g = (cands.length ? cands : gens)[Math.floor(r() * (cands.length || gens.length))];
      const q = g.make(r);
      if (!q || seen.indexOf(fp(q)) >= 0 || out.some(o => fp(o) === fp(q))) continue;
      q._tpl = g.id;
      out.push(q);
      secUsed[q.sec] = (secUsed[q.sec] || 0) + 1;
    }
    // ③ 见过原卷题一直比生成题优先（原卷是孩子在考试里真会碰到的题型）
    if (out.length < count) {
      for (const q of shuffled(BANK.filter(q => q.lv === lv && !out.some(o => fp(o) === fp(q))).slice(), r)) {
        if (out.length >= count) break;
        out.push(shuffleOpts(q, r));
      }
    }
    // ④ 题型太集中时换题：一轮里同一 sec 不超 count 的一半（owner 2026-11-20「太单一」）
    const cap = Math.max(2, Math.ceil(count / 2));
    for (const s of Object.keys(secUsed)) {
      let mine = out.filter(q => q.sec === s);
      while (mine.length > cap) {
        const extra = mine.pop();
        const at = out.indexOf(extra);
        const alt = shuffled(BANK.filter(q => q.lv === lv && q.sec !== s && !out.some(o => fp(o) === fp(q))), r)[0];
        if (alt && at >= 0) out[at] = shuffleOpts(alt, r); else break;
      }
    }
    noteSeen(out.map(fp));
    return shuffled(out, r);
  }
  /* 原卷选择题：选项顺序每次打乱（opts/optse 一起），不能靠「上次是第二个」记位置 */
  function shuffleOpts(q, rng) {
    if (!q || !Array.isArray(q.opts) || q.opts.length < 2) return q;
    const idx = shuffled(q.opts.map((_, i) => i), rng);
    const c = Object.assign({}, q, { opts: idx.map(i => q.opts[i]) });
    if (Array.isArray(q.optse) && q.optse.length === q.opts.length) c.optse = idx.map(i => q.optse[i]);
    return c;
  }
  /* 复练：错题/跳过的题按同型模板重新生成一道新数据的题，不是原题重来 */
  function variant(q, rng) {
    const r = rng || Math.random;
    const g = q && q._tpl && GEN.filter(x => x.id === q._tpl)[0];
    if (!g) {
      // 原卷题没有模板：原题刚讲过答案，再做就是背。换同档同类（sec）的另一道没见过的原卷题，
      // 没有就换同档生成题
      if (!q) return null;
      const seen = loadSeen();
      const same = shuffled(BANK.filter(b => b.lv === q.lv && b.sec === q.sec && fp(b) !== fp(q) && seen.indexOf(fp(b)) < 0), r);
      if (same.length) { noteSeen([fp(same[0])]); return shuffleOpts(same[0], r); }
      const gens = GEN.filter(x => x.lv === q.lv);
      for (let i = 0; i < 12 && gens.length; i++) {
        const gg = gens[Math.floor(r() * gens.length)], nq = gg.make(r);
        if (nq && seen.indexOf(fp(nq)) < 0) { nq._tpl = gg.id; return nq; }
      }
      return null;
    }
    for (let i = 0; i < 12; i++) {
      const nq = g.make(r);
      if (nq && fp(nq) !== fp(q)) { nq._tpl = g.id; return nq; }
    }
    const nq = g.make(r);
    if (nq) nq._tpl = g.id;
    return nq;
  }

  const api = { BANK, GEN, LEVELS, pick, variant, fp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.TIMO = api;
})();
