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
    /* ---------- K2 / 幼稚园组：2017 heat ---------- */
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q1',
      q: '积及的爸爸有四个孩子，其中两个是儿子。积及一共有多少个兄弟姊妹？',
      qy: '积及爸爸有四个细路，当中两个系仔。积及一共有几多个兄弟姊妹？',
      qe: 'Jacob\'s father has four children. Two of them are sons. How many brothers and sisters does Jacob have in total?',
      a: '2', ans: 'num', hint: '想一想：四个孩子里两个是儿子，另外两个呢？', hinty: '谂下：四个细路两个系仔，另外两个系咩？', hinte: 'Think: four children, two are sons. What are the other two?',
      expe: 'Two of the four children are sons, so the other two are daughters. Jacob is one of the sons, so he has 2 siblings.',
    },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q3',
      q: '按规律：1、1、2、3、5、8，下一个是多少？',
      qy: '跟规律：1、1、2、3、5、8，下一个系几多？',
      qe: 'Pattern: 1, 1, 2, 3, 5, 8. What comes next?',
      a: '13', ans: 'num', hint: '把前面两个数加起来看看。', hinty: '试下将前面两个数加起来。', hinte: 'Try adding the two numbers before it.',
      expe: 'Each number is the sum of the two before it: 5 + 8 = 13.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q6',
      q: '3 加 3 加 3 加 3 加 3 等于多少？',
      qy: '3 加 3 加 3 加 3 加 3 等于几多？',
      qe: 'What is 3 + 3 + 3 + 3 + 3?',
      a: '15', ans: 'num', hint: '3 个 3 是 9，再加两个 3。', hinty: '3 个 3 系 9，再加两个 3。', hinte: 'Three 3s make 9. Add two more 3s.',
      expe: 'Five 3s added together make 15, which is 3 × 5.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q7',
      q: '17 减 8 再减 7 等于多少？',
      qy: '17 减 8 再减 7 等于几多？',
      qe: 'What is 17 − 8 − 7?',
      a: '2', ans: 'num', hint: '先算 17 减 8。', hinty: '先算 17 减 8。', hinte: 'Start with 17 minus 8.',
      expe: '17 − 8 = 9, then 9 − 7 = 2.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q9',
      q: '14 加 11 加 8 等于多少？',
      qy: '14 加 11 加 8 等于几多？',
      qe: 'What is 14 + 11 + 8?',
      a: '33', ans: 'num', hint: '先算 14 加 11。', hinty: '先算 14 加 11。', hinte: 'First do 14 + 11.',
      expe: '14 + 11 = 25, then 25 + 8 = 33.',
    },
    { lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q11',
      q: '艾美有 8 个苹果，约翰一个都没有。要让两人苹果一样多，艾美要给约翰多少个？',
      qy: '艾美有 8 个苹果，约翰一个都冇。要让两个人一样多，艾美要畀约翰几多个？',
      qe: 'Amy has 8 apples and John has none. How many apples must Amy give John so they have the same number?',
      a: '4', ans: 'num', hint: '两个人一样多，每人应该是几个？', hinty: '两个人一样多，每人应该有幾多个？', hinte: 'If they end up equal, how many would each have?',
      expe: 'Split 8 apples into two equal shares of 4, so Amy gives John 4 apples.',
    },
    { lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q15',
      q: '按规律：13、11、9、7，下一个是多少？',
      qy: '跟规律：13、11、9、7，下一个系几多？',
      qe: 'Pattern: 13, 11, 9, 7. What comes next?',
      a: '5', ans: 'num', hint: '每次少了多少？', hinty: '每次少咗几多？', hinte: 'How much does it go down each time?',
      expe: 'It goes down by 2 each time, so the next number is 5.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q21',
      q: '把 10 颗星分成一样多的两份，每份多少颗？',
      qy: '将 10 粒星分成一样多嘅两份，每份幾多粒？',
      qe: 'Split 10 stars into two equal groups. How many stars in each group?',
      a: '5', ans: 'num', hint: '一半是多少？', hinty: '一半系幾多？', hinte: 'What is half of 10?',
      expe: 'Half of 10 is 5.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q22',
      q: '下面这些数里有多少个奇数（单数）：1、2、3、6、11、20、37、68？',
      qy: '下面呢啲数里面有几个奇数（单数）：1、2、3、6、11、20、37、68？',
      qe: 'How many odd numbers are there: 1, 2, 3, 6, 11, 20, 37, 68?',
      a: '4', ans: 'num', hint: '奇数的个位是 1、3、5、7、9。', hinty: '奇数嘅个位系 1、3、5、7、9。', hinte: 'Odd numbers end in 1, 3, 5, 7 or 9.',
      expe: '1, 3, 11 and 37 are odd, so there are 4 odd numbers.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q23',
      q: '下面这些数里有多少个偶数（双数）：1、4、5、9、14、23、37、60？',
      qy: '下面呢啲数里面有几个偶数（双数）：1、4、5、9、14、23、37、60？',
      qe: 'How many even numbers are there: 1, 4, 5, 9, 14, 23, 37, 60?',
      a: '3', ans: 'num', hint: '偶数的个位是 0、2、4、6、8。', hinty: '偶数嘅个位系 0、2、4、6、8。', hinte: 'Even numbers end in 0, 2, 4, 6 or 8.',
      expe: '4, 14 and 60 are even, so there are 3 even numbers.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q24',
      q: '用 1、2、4 三个数字各用一次，能组成最大的三位数是多少？',
      qy: '用 1、2、4 三个数字每个用一次，可以组成最大嘅三位数系几多？',
      qe: 'Use the digits 1, 2 and 4 once each to make the largest 3-digit number. What is it?',
      a: '421', ans: 'num', hint: '最大的数字放百位。', hinty: '最大嘅数字放百位。', hinte: 'Put the biggest digit in the hundreds place.',
      expe: 'Put the digits from biggest to smallest: 421.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q25',
      q: '彼得有 4 枚 1 元、2 枚 5 元和 1 枚 10 元硬币，他最多能买多少元的纪念品？',
      qy: '彼得有 4 个 1 蚊、2 个 5 蚊同 1 个 10 蚊，佢最多买幾多蚊嘅纪念品？',
      qe: 'Peter has 4 one-dollar coins, 2 five-dollar coins and 1 ten-dollar coin. What is the most he can spend?',
      a: '24', ans: 'num', hint: '先把所有钱加起来。', hinty: '先将所有钱加埋。', hinte: 'Add all the coins up.',
      expe: '4 × 1 + 2 × 5 + 10 = 4 + 10 + 10 = 24 dollars.',
    },

    /* ---------- K2 / 幼稚园组：2018 final ---------- */
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q1',
      q: '积及是家里最小的男孩，他有 4 个姐姐、没有哥哥弟弟。积及家一共有多少个孩子？',
      qy: '积及系屋企最细嘅仔，佢有 4 个家姐、冇兄弟。积及屋企一共有几个细路？',
      qe: 'Jacob is the youngest boy, with 4 elder sisters and no brothers. How many children are in the family?',
      a: '5', ans: 'num', hint: '别忘了算积及自己。', hinty: '唔好漏咗积及自己。', hinte: 'Remember to count Jacob himself.',
      expe: '4 sisters plus Jacob himself makes 5 children.',
    },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q3',
      q: '按规律：A、C、E、G、I，下一个字母是什么？',
      qy: '跟规律：A、C、E、G、I，下一个字母系咩？',
      qe: 'Pattern: A, C, E, G, I. What letter comes next?',
      a: 'K', ans: 'choice', opts: ['J', 'K', 'L', 'M'], hint: '字母表里每次跳过几个？', hinty: '字母表里面每次跳过几个？', hinte: 'How many letters are skipped each time?',
      expe: 'The letters skip one each time: A, C, E, G, I, then K.',
    },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q4',
      q: '按规律：1、8、3、6、5、4，下一个是多少？',
      qy: '跟规律：1、8、3、6、5、4，下一个系几多？',
      qe: 'Pattern: 1, 8, 3, 6, 5, 4. What comes next?',
      a: '7', ans: 'num', hint: '一个在变大，一个在变小，看看分别怎么走。', hinty: '一个系变大，一个系变细，睇下佢哋点行。', hinte: 'One sequence goes up, one goes down. Look at each.',
      expe: 'The odd places go 1, 3, 5, 7 (+2 each) and the even places go 8, 6, 4 (−2 each), so the next is 7.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q6',
      q: '2 加 2 加 2 加 2 加 2 等于多少？',
      qy: '2 加 2 加 2 加 2 加 2 等于几多？',
      qe: 'What is 2 + 2 + 2 + 2 + 2?',
      a: '10', ans: 'num', hint: '数一数有几个 2。', hinty: '数下有幾多个 2。', hinte: 'Count how many 2s there are.',
      expe: 'Five 2s added together make 10, which is 2 × 5.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q7',
      q: '18 减 6 再减 8 等于多少？',
      qy: '18 减 6 再减 8 等于几多？',
      qe: 'What is 18 − 6 − 8?',
      a: '4', ans: 'num', hint: '先算 18 减 6。', hinty: '先算 18 减 6。', hinte: 'Start with 18 minus 6.',
      expe: '18 − 6 = 12, then 12 − 8 = 4.',
    },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q9',
      q: '10 减 9 加 8 减 7 加 6 减 5 加 4 减 3 加 2 减 1 等于多少？',
      qy: '10 减 9 加 8 减 7 加 6 减 5 加 4 减 3 加 2 减 1 等于几多？',
      qe: 'What is 10 − 9 + 8 − 7 + 6 − 5 + 4 − 3 + 2 − 1?',
      a: '5', ans: 'num', hint: '把成对的数放在一起算：10−9、8−7……', hinty: '将一对一对嘅数放埋一齐算：10−9、8−7……', hinte: 'Pair them up: 10−9, 8−7, and so on.',
      expe: 'Each pair like 10 − 9 or 8 − 7 equals 1. There are 5 pairs, so the total is 5.',
    },
    { lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q11',
      q: '艾美有 7 个梨，约翰有 1 个。要让两人一样多，艾美要给约翰多少个？',
      qy: '艾美有 7 个梨，约翰有 1 个。要让两个人一样多，艾美要畀约翰幾多个？',
      qe: 'Amy has 7 pears and John has 1. How many must Amy give John so they have the same?',
      a: '3', ans: 'num', hint: '一共 8 个梨，一样多的话每人几个？', hinty: '一共 8 个梨，一样多嘅话每人幾多个？', hinte: 'There are 8 pears in total. If equal, how many each?',
      expe: 'There are 8 pears, so 4 each. John already has 1, so Amy gives him 3.',
    },
    { lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q15',
      q: '按规律：10、7、4，下一个是多少？',
      qy: '跟规律：10、7、4，下一个系几多？',
      qe: 'Pattern: 10, 7, 4. What comes next?',
      a: '1', ans: 'num', hint: '每次少了多少？', hinty: '每次少咗几多？', hinte: 'How much is taken away each time?',
      expe: 'It goes down by 3 each time, so 4 − 3 = 1.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q21',
      q: '把 8 颗星分成一样多的两份，每份多少颗？',
      qy: '将 8 粒星分成一样多嘅两份，每份幾多粒？',
      qe: 'Split 8 stars into two equal groups. How many in each group?',
      a: '4', ans: 'num', hint: '一半是多少？', hinty: '一半系幾多？', hinte: 'What is half of 8?',
      expe: 'Half of 8 is 4.',
    },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q24',
      q: '下面这些数里有多少个两位数：2、14、15、27、4、32、47？',
      qy: '下面呢啲数里面有几个两位数：2、14、15、27、4、32、47？',
      qe: 'How many two-digit numbers are there: 2, 14, 15, 27, 4, 32, 47?',
      a: '5', ans: 'num', hint: '两位数要有十位。', hinty: '两位数要有十位。', hinte: 'Two-digit numbers need a tens digit.',
      expe: 'Two-digit numbers need a tens digit: 14, 15, 27, 32 and 47, so 5 of them (2 and 4 are single digits).',
    },

    /* ---------- P1 / 小学一年级：2018 question paper ---------- */
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q1',
      q: '积及是家里最大的男孩，他有 4 个妹妹、3 个弟弟。积及家一共有多少个孩子？',
      qy: '积及系屋企最大嘅仔，佢有 4 个细妹、3 个细佬。积及屋企一共有几个细路？',
      qe: 'Jacob is the eldest boy with 4 younger sisters and 3 younger brothers. How many children are in the family?',
      a: '8', ans: 'num', hint: '把弟弟妹妹加起来，别忘了积及自己。', hinty: '将细佬细妹加埋，唔好漏咗积及自己。', hinte: 'Add the siblings, and don\'t forget Jacob himself.',
      expe: '4 + 3 = 7 siblings, plus Jacob himself makes 8 children.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q2',
      q: '2018 年里，只有 30 天的月份有几个？',
      qy: '2018 年里面，得 30 日嘅月份有几个？',
      qe: 'In 2018, how many months have exactly 30 days?',
      a: '4', ans: 'num', hint: '4、6、9、11 月是 30 天。', hinty: '4、6、9、11 月系 30 日。', hinte: 'April, June, September and November have 30 days.',
      expe: 'April, June, September and November have 30 days, so 4 months.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q3',
      q: '4 年前艾美 13 岁，3 年后艾美多少岁？',
      qy: '4 年前艾美 13 岁，3 年后艾美幾多岁？',
      qe: 'Four years ago Amy was 13. How old will she be in 3 years?',
      a: '20', ans: 'num', hint: '先算艾美现在多少岁。', hinty: '先算艾美而家幾多岁。', hinte: 'First work out Amy\'s age now.',
      expe: 'She is 13 + 4 = 17 now, so in 3 years she will be 20.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q4',
      q: '按规律：1、7、13、19、25，下一个是多少？',
      qy: '跟规律：1、7、13、19、25，下一个系几多？',
      qe: 'Pattern: 1, 7, 13, 19, 25. What comes next?',
      a: '31', ans: 'num', hint: '每次加了多少？', hinty: '每次加咗幾多？', hinte: 'How much is added each time?',
      expe: 'Each term adds 6, so 25 + 6 = 31.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q5',
      q: '按规律：A、D、G、J、M，下一个字母是什么？',
      qy: '跟规律：A、D、G、J、M，下一个字母系咩？',
      qe: 'Pattern: A, D, G, J, M. What letter comes next?',
      a: 'P', ans: 'choice', opts: ['N', 'O', 'P', 'Q'], hint: '数一数每次跳过几个字母。', hinty: '数下每次跳过幾多个字母。', hinte: 'Count how many letters are skipped.',
      expe: 'Two letters are skipped each time: A, D, G, J, M, then P.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q6',
      q: '2 加 3 加 5 加 6 加 8 加 9 等于多少？',
      qy: '2 加 3 加 5 加 6 加 8 加 9 等于几多？',
      qe: 'What is 2 + 3 + 5 + 6 + 8 + 9?',
      a: '33', ans: 'num', hint: '把能凑成 10 的先加起来。', hinty: '将凑到 10 嘅先加埋。', hinte: 'Look for pairs that make 10 first.',
      expe: '2 + 8 = 10, 3 + 6 + 9 = 18, plus 5 makes 33.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q7',
      q: '27 加 18 再减 17 等于多少？',
      qy: '27 加 18 再减 17 等于几多？',
      qe: 'What is 27 + 18 − 17?',
      a: '28', ans: 'num', hint: '27 减 17 是多少？', hinty: '27 减 17 系几多？', hinte: 'What is 27 − 17?',
      expe: '27 − 17 = 10, then 10 + 18 = 28.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q8',
      q: 'A 是一位数，3 乘 A 等于 3 加 3 加 3 加 3 加 3，A 是多少？',
      qy: 'A 系一位数，3 乘 A 等于 3 加 3 加 3 加 3 加 3，A 系几多？',
      qe: 'A is a 1-digit number and 3 × A = 3 + 3 + 3 + 3 + 3. What is A?',
      a: '5', ans: 'num', hint: '右边有几个 3？', hinty: '右边有几个 3？', hinte: 'How many 3s are on the right?',
      expe: 'The right side is five 3s, which is 15, so A = 5.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q9',
      q: '35 加多少等于 42？',
      qy: '35 加幾多等于 42？',
      qe: '35 + ___ = 42. What number fills the blank?',
      a: '7', ans: 'num', hint: '42 减 35 是多少？', hinty: '42 减 35 系几多？', hinte: 'What is 42 − 35?',
      expe: '42 − 35 = 7.',
    },
    { lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q13',
      q: '四个学生一共有 16 个气球，每人数量都不一样。气球最多的那个至少有几个？',
      qy: '四个学生一共有 16 个气球，每人数量都唔同。气球最多嘅嗰个至少有幾多个？',
      qe: 'Four students have 16 balloons in total, all different amounts. At least how many does the one with most have?',
      a: '6', ans: 'num', hint: '让其他人尽量多，剩下的就是最多的那个。', hinty: '畀其他人尽量多，剩低嘅就系最多嗰个。', hinte: 'Make the others as large as possible; the rest is the biggest.',
      expe: 'To keep the biggest number small, make the others as large as possible: 4 + 5 + 6 = 15 leaves 1, so the different amounts are 1, 4, 5 and 6 and the most is 6.',
    },
    { lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q15',
      q: '个位数是 6 的两位数有多少个？',
      qy: '个位数系 6 嘅两位数有幾多个？',
      qe: 'How many two-digit numbers end in 6?',
      a: '9', ans: 'num', hint: '十位可以是 1 到 9。', hinty: '十位可以系 1 到 9。', hinte: 'The tens digit can be 1 to 9.',
      expe: '16, 26, 36, 46, 56, 66, 76, 86 and 96 make 9 numbers.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q21',
      q: '把 10 分成两个一位数相加，有多少种方法？（5+6 和 6+5 算同一种）',
      qy: '将 10 分成两个一位数相加，有幾多种方法？（5+6 同 6+5 当同一种）',
      qe: 'Split 10 into two 1-digit numbers. How many ways? (5+6 and 6+5 count as one.)',
      a: '5', ans: 'num', hint: '从 1+9 开始，一个一个数。', hinty: '由 1+9 开始，一个一个数。', hinte: 'Start from 1+9 and count one by one.',
      expe: '1 + 9, 2 + 8, 3 + 7, 4 + 6 and 5 + 5 make 5 ways.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q24',
      q: '最大的一位偶数和最小的两位奇数加起来是多少？',
      qy: '最大嘅一位偶数同最细嘅两位奇数加埋系几多？',
      qe: 'Add the greatest 1-digit even number and the smallest 2-digit odd number.',
      a: '19', ans: 'num', hint: '最大的一位偶数是 8，最小的两位奇数是 11。', hinty: '最大嘅一位偶数系 8，最细嘅两位奇数系 11。', hinte: 'Greatest 1-digit even is 8; smallest 2-digit odd is 11.',
      expe: 'The greatest 1-digit even number is 8 and the smallest 2-digit odd number is 11, so 8 + 11 = 19.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q25',
      q: '彼得有 12 枚 1 元硬币，能换多少个 2 元硬币？',
      qy: '彼得有 12 个 1 蚊，可以换幾多个 2 蚊？',
      qe: 'Peter has 12 one-dollar coins. How many two-dollar coins can he exchange them for?',
      a: '6', ans: 'num', hint: '每 2 个 1 元换 1 个 2 元。', hinty: '每 2 个 1 蚊换 1 个 2 蚊。', hinte: 'Two 1-dollar coins make one 2-dollar coin.',
      expe: '12 ÷ 2 = 6.',
    },

    /* ---------- P1 / 小学一年级：2020-2021 mock（原卷附答案页） ---------- */
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q1',
      q: '玛丽有一个哥哥和三个妹妹，玛丽的哥哥有几个妹妹？',
      qy: '玛丽有一个阿哥同三个细妹，玛丽个阿哥有幾多个细妹？',
      qe: 'Mary has one elder brother and three younger sisters. How many sisters does Mary\'s brother have?',
      a: '4', ans: 'num', hint: '玛丽自己也是妹妹。', hinty: '玛丽自己都系妹妹。', hinte: 'Mary herself is also a sister.',
      expe: 'Three sisters plus Mary herself makes 4 sisters for the brother.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q2',
      q: '艾美、宾利、云妮各有一只宠物：猫、狗或兔。艾美养的不是猫，宾利养的是兔子，云妮养的是什么？',
      qy: '艾美、宾利、云妮各有一只宠物：猫、狗或者兔。艾美养嘅唔系猫，宾利养嘅系兔，云妮养嘅系咩？',
      qe: 'Amy, Benny and Winnie each have a cat, a dog or a bunny. Amy does not have a cat, Benny has a bunny. What does Winnie have?',
      a: '猫', ans: 'choice', opts: ['猫', '狗', '兔'], optse: ['cat', 'dog', 'bunny'], hint: '宾利占了兔，剩下猫和狗。', hinty: '宾利要咗兔，剩低猫同狗。', hinte: 'Benny has the bunny. Cat and dog are left.',
      expe: 'Benny has the bunny. Amy is not the cat, so Amy has the dog and Winnie has the cat.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q3',
      q: '要把一个蛋糕切成 4 份，最少要切几刀？',
      qy: '要将一个蛋糕切成 4 份，最少要切幾多刀？',
      qe: 'At least how many cuts are needed to cut a cake into 4 parts?',
      a: '2', ans: 'num', hint: '一刀切两半，两刀呢？', hinty: '一刀切两半，两刀呢？', hinte: 'One cut makes two halves. What about two cuts?',
      expe: 'Two crossing cuts make 4 parts.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q4',
      q: '约翰写了一个两位数。彼得问「是 16 吗？」，约翰说「有一个数字对，但位置错了」。彼得再问「是 67 吗？」，约翰说「有一个数字对，但位置错了」。这个数是多少？',
      qy: '约翰写咗一个两位数。彼得问「系 16 咩？」，约翰话「有一个数字啱，但位置错咗」。彼得再问「系 67 咩？」，约翰话「有一个数字啱，但位置错咗」。呢个数系几多？',
      qe: 'John wrote a 2-digit number. For 16: "one digit is right but in the wrong place." For 67: same answer. What is the number?',
      a: '71', ans: 'num', hint: '16 里有 1 或 6；67 里有 6 或 7。共同的那个数字不能在自己的位置上。', hinty: '16 里面有 1 或者 6；67 里面有 6 或者 7。共同嗰个数字唔可以喺自己位置。', hinte: 'The shared digit must be in the other place.',
      expe: 'Take the 1 from 16 into the units place and the 7 from 67 into the tens place: 71 fits both hints.',
    },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q5',
      q: '按规律：第 1 组 1 个圆，第 2 组 4 个圆，第 3 组 9 个圆。第 4 组有多少个圆？',
      qy: '跟规律：第 1 组 1 个圆，第 2 组 4 个圆，第 3 组 9 个圆。第 4 组有幾多个圆？',
      qe: 'Group 1 has 1 circle, group 2 has 4, group 3 has 9. How many in group 4?',
      a: '16', ans: 'num', hint: '1、4、9 分别是几个自己相乘？', hinty: '1、4、9 分别系几个自己乘自己？', hinte: '1, 4, 9 are squares. What is the next square?',
      expe: '1 × 1, 2 × 2, 3 × 3, so group 4 has 4 × 4 = 16 circles.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q6',
      q: '3 连加 10 次，等于多少？',
      qy: '3 连加 10 次，等于几多？',
      qe: 'What is 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3?',
      a: '30', ans: 'num', hint: '10 个 3 是多少？', hinty: '10 个 3 系几多？', hinte: 'What is ten 3s?',
      expe: '3 × 10 = 30.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q7',
      q: '82 减 19 再减 42 等于多少？',
      qy: '82 减 19 再减 42 等于几多？',
      qe: 'What is 82 − 19 − 42?',
      a: '21', ans: 'num', hint: '82 减 42 是多少？', hinty: '82 减 42 系几多？', hinte: 'What is 82 − 42?',
      expe: '82 − 42 = 40, then 40 − 19 = 21.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q8',
      q: '22 加多少等于 30？',
      qy: '22 加幾多等于 30？',
      qe: '22 + ___ = 30. What number fills the blank?',
      a: '8', ans: 'num', hint: '30 减 22。', hinty: '30 减 22。', hinte: 'Do 30 − 22.',
      expe: '30 − 22 = 8.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q9',
      q: '1 加 2 加 3 加 4 加 5 加 6 加 7 加 8 加 9 加 10 加 11 等于多少？',
      qy: '1 加 2 加 3 加 4 加 5 加 6 加 7 加 8 加 9 加 10 加 11 等于几多？',
      qe: 'What is 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11?',
      a: '66', ans: 'num', hint: '1+10、2+9、3+8……这样配对。', hinty: '1+10、2+9、3+8……咁样配对。', hinte: 'Pair them: 1+10, 2+9, 3+8...',
      expe: '1 + 2 + ... + 10 = 55, plus 11 makes 66.',
    },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q10',
      q: 'A 和 B 都是一位数，18 减 A 等于 B，A 是多少？（答案页给 9）',
      qy: 'A 同 B 都系一位数，18 减 A 等于 B，A 系几多？（答案页畀 9）',
      qe: 'A and B are 1-digit numbers and 18 − A = B. What is A?',
      a: '9', ans: 'num', hint: '18 减几多会得到一位数？', hinty: '18 减幾多会得到一位数？', hinte: '18 minus what gives a single digit?',
      expe: 'A is one digit, so the largest is 9: 18 − 9 = 9 and A = B = 9.',
    },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q11',
      q: '艾美有 10 个苹果，约翰有 4 个。要让两人一样多，艾美要给约翰多少个？',
      qy: '艾美有 10 个苹果，约翰有 4 个。要让两个人一样多，艾美要畀约翰幾多个？',
      qe: 'Amy has 10 apples and John has 4. How many must Amy give John so they are equal?',
      a: '3', ans: 'num', hint: '一共 14 个，一样多每人几个？', hinty: '一共 14 个，一样多每人幾多个？', hinte: 'There are 14 in total. If equal, how many each?',
      expe: 'There are 14 apples, so 7 each. John already has 4, so Amy gives him 3.',
    },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q13',
      q: '四个小孩一共有 11 个气球，每人数量都不同，而且每人至少 1 个。气球最多的那个有多少个？',
      qy: '四个细路一共有 11 个气球，每人数量都唔同，而且每人至少有 1 个。气球最多嘅嗰个有幾多个？',
      qe: 'Four children have 11 balloons in total, all different, at least one each. How many does the one with most have?',
      a: '5', ans: 'num', hint: '先给三个人尽量少：1、2、3。', hinty: '先畀三个人尽量少：1、2、3。', hinte: 'Give the others as few as possible: 1, 2, 3.',
      expe: 'Give the other three as few as possible: 1 + 2 + 3 = 6, leaving 5 for the fourth child.',
    },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q14',
      q: '个位数是 0 的两位数有多少个？',
      qy: '个位数系 0 嘅两位数有幾多个？',
      qe: 'How many two-digit numbers end in 0?',
      a: '9', ans: 'num', hint: '十位可以是 1 到 9。', hinty: '十位可以系 1 到 9。', hinte: 'The tens digit can be 1 to 9.',
      expe: '10, 20, 30, 40, 50, 60, 70, 80 and 90 make 9 numbers.',
    },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q15',
      q: '按规律：1、4、7、10、13，下一个是多少？',
      qy: '跟规律：1、4、7、10、13，下一个系几多？',
      qe: 'Pattern: 1, 4, 7, 10, 13. What comes next?',
      a: '16', ans: 'num', hint: '每次加了多少？', hinty: '每次加咗幾多？', hinte: 'How much is added each time?',
      expe: 'Each term adds 3, so 13 + 3 = 16.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q21',
      q: '把 8 粒糖果分成一样多的两份，每份多少粒？',
      qy: '将 8 粒糖分成一样多嘅两份，每份幾多粒？',
      qe: 'Split 8 candies into two equal groups. How many in each?',
      a: '4', ans: 'num', hint: '一半是多少？', hinty: '一半系幾多？', hinte: 'What is half of 8?',
      expe: 'Half of 8 is 4.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q22',
      q: '从 1、3、5、8 里选 2 个不重复的数字组成两位数，能组成多少个奇数？',
      qy: '从 1、3、5、8 里面拣 2 个唔重复嘅数字组成两位数，可以组成幾多个奇数？',
      qe: 'From 1, 3, 5, 8 pick 2 digits without repeating to make two-digit numbers. How many are odd?',
      a: '9', ans: 'num', hint: '奇数要个位是 1、3、5。', hinty: '奇数要个位系 1、3、5。', hinte: 'Odd numbers need units digit 1, 3 or 5.',
      expe: 'The units digit is 1, 3 or 5 and the tens digit has 3 choices each, so 3 × 3 = 9 odd numbers.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q23',
      q: '从学校到车站有 3 条路，从车站到图书馆有 2 条路。经车站从学校到图书馆有多少种走法？',
      qy: '由学校去车站有 3 条路，由车站去图书馆有 2 条路。经车站由学校去图书馆有幾多种走法？',
      qe: 'There are 3 ways from school to the station and 2 from the station to the library. How many ways from school to the library via the station?',
      a: '6', ans: 'num', hint: '每一段都配一次。', hinty: '每一段都配一次。', hinte: 'Each first-leg choice pairs with each second-leg choice.',
      expe: '3 × 2 = 6 ways.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q24',
      q: '用 3、6、1、8 各用一次，组成最小的四位数是多少？',
      qy: '用 3、6、1、8 每个用一次，组成最细嘅四位数系几多？',
      qe: 'Use 3, 6, 1, 8 once each to make the smallest 4-digit number.',
      a: '1368', ans: 'num', hint: '最小的数字放千位。', hinty: '最细嘅数字放千位。', hinte: 'Put the smallest digit first.',
      expe: 'Put the digits from smallest to largest: 1368.',
    },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q25',
      q: '从 0、3、5、6、9 里选 2 个不重复的数字组成两位数，能组成多少个 5 的倍数？',
      qy: '从 0、3、5、6、9 里面拣 2 个唔重复嘅数字组成两位数，可以组成幾多个 5 嘅倍数？',
      qe: 'From 0, 3, 5, 6, 9 pick 2 digits without repeating to make two-digit multiples of 5. How many?',
      a: '7', ans: 'num', hint: '5 的倍数个位是 0 或 5；十位不能是 0。', hinty: '5 嘅倍数个位系 0 或者 5；十位唔可以系 0。', hinte: 'Multiples of 5 end in 0 or 5; the tens digit cannot be 0.',
      expe: 'Ending in 0: 30, 50, 60, 90 (4); ending in 5: 35, 65, 95 (3); so 7 multiples.',
    },
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
          qe: `Ming has ${x} apples and Hong has ${y}. How many more does Ming have?`,
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

  /* 按档位出题（反背题）：优先现场生成的题（约 3/4），避开最近出过的题面；
     原卷题库只用来补位，保证每轮有真实卷别出处。 */
  function pick(lv, n, rng) {
    const r = rng || Math.random;
    const count = Math.max(1, n || 8);
    const seen = loadSeen();
    const gens = GEN.filter(g => g.lv === lv);
    const out = [], usedTpl = new Set();
    const wantGen = Math.min(gens.length, Math.max(2, Math.round(count * 0.75)));
    let guard = 0;
    while (out.length < wantGen && guard++ < 600) {
      const g = gens[Math.floor(r() * gens.length)];
      if (usedTpl.has(g.id)) continue;
      const q = g.make(r);
      if (!q || seen.indexOf(fp(q)) >= 0) continue;
      q._tpl = g.id;
      usedTpl.add(g.id);
      out.push(q);
    }
    const fresh = shuffled(BANK.filter(q => q.lv === lv && seen.indexOf(fp(q)) < 0).slice(), r);
    for (const q of fresh) { if (out.length >= count) break; out.push(shuffleOpts(q, r)); }
    // 原卷题做完了先用生成题（模板可重复、数字换新）补，不拿见过的原卷题——一天十几轮，原卷题两天就轮完，
    // 再出就是背答案（2026-11-20 K2 一天 13 轮，多数 8/8）
    guard = 0;
    while (out.length < count && gens.length && guard++ < 600) {
      const g = gens[Math.floor(r() * gens.length)];
      const q = g.make(r);
      if (!q || seen.indexOf(fp(q)) >= 0 || out.some(o => fp(o) === fp(q))) continue;
      q._tpl = g.id;
      out.push(q);
    }
    if (out.length < count) {   // 实在不够才用见过的原卷题
      for (const q of shuffled(BANK.filter(q => q.lv === lv && !out.some(o => fp(o) === fp(q))).slice(), r)) {
        if (out.length >= count) break;
        out.push(shuffleOpts(q, r));
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
