/* ======== TIMO 奥数题库（2026-11-20 重建）：K2/幼稚园组 + 小学一年级 Primary 1 ========
 *
 * 来源：/Volumes/S/Workplace/timo-papers 里四份完整题本，逐页对照原卷图片重录（2026-11-20）：
 *   TIMO-2017-heat-Kindergarten / TIMO-2018-final-Kindergarten（无答案页，答案逐题自算）
 *   TIMO-2018-Primary-1 question paper（无答案页，答案逐题自算）
 *   TIMO-2020-2021-mock-Primary-1（有答案页，逐题核对）
 * 11-20 上午的「100 题」版本把 2020 模拟卷整卷复制成 2018 卷、几何题凭空编、十多道答案错，已整体替换。
 * 三道「最少几个立方体」（K2 2017 Q17、K2 2018 Q17、P1 2018 Q17）立体图看不准、又没有答案页，不收；
 * 2020 模拟卷 Q17 有答案页（6），收。
 *
 * 字段：
 *   lv   'k2' | 'p1'      档位（幼稚园 K2 组 / 小学一年级）
 *   sec  题型分区（原卷五大范畴）：逻辑 / 算术 / 数论 / 几何 / 组合
 *   q/qy/qe  题面（普通话 / 粤语口语 / 英文），念出来要能听懂
 *   show 屏幕上大字显示的式子/数列/图形序列（不随语言变，念题仍按 q）
 *   fig  原卷图形裁图（web/v2/timo_fig/*.png），题面里说「看图」
 *   svg  生成题现画的图（字符串，页面直接嵌）
 *   a    正确答案（字符串，比较时归一化）
 *   ans  'num' 数字 | 'choice' 从 opts 里选；optse 英文界面选项（和 opts 一一对应）
 *   hint/hinty/hinte  提示（不给答案）；exp/expe 讲解；howto/howtoe 这类题怎么想
 *   src  出处（卷 + 题号）
 */
(function () {
  'use strict';

  const MINUS = '−';
  /* 填加减号题：原卷要写完整算式。语音/点选都难，改成「选哪一条算式对」——
     选项是全部可能里挑的（正确的 + 3 条错的），算式写全，孩子要逐条算，不是猜一个符号 */
  function signs(nums, target) {
    const gaps = nums.length - 1, all = [];
    for (let m = 0; m < (1 << gaps); m++) {
      let v = nums[0], s = String(nums[0]);
      for (let i = 0; i < gaps; i++) {
        const plus = !(m & (1 << (gaps - 1 - i)));
        v += plus ? nums[i + 1] : -nums[i + 1];
        s += (plus ? ' + ' : ` ${MINUS} `) + nums[i + 1];
      }
      all.push({ s, v });
    }
    const good = all.filter(x => x.v === target);
    if (good.length !== 1) throw new Error('signs: not unique ' + nums + '=' + target);
    const wrong = all.filter(x => x.v !== target).sort((x, y) => Math.abs(x.v - target) - Math.abs(y.v - target)).slice(0, 3);
    return { a: good[0].s, opts: [good[0].s].concat(wrong.map(x => x.s)), show: nums.join(' __ ') + ' = ' + target };
  }
  const SHAPE = { opts: ['圆', '方', '三角'], optse: ['circle', 'square', 'triangle'] };

  const BANK = [
    /* ================= TIMO-2017-heat-Kindergarten ================= */
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q1', a: '3', ans: 'num',
      q: '积及的爸爸有四个孩子，其中两个是儿子。积及有多少个兄弟姊妹？', qy: '积及爸爸有四个细路，其中两个系仔。积及有几多个兄弟姊妹？',
      qe: "Jacob's father has four children. Two of them are sons. How many brothers and sisters does Jacob have?",
      hint: '积及自己是儿子之一，兄弟姊妹不算自己。', hinty: '积及自己系其中一个仔，兄弟姊妹唔计自己。', hinte: 'Jacob is one of the sons. Do not count Jacob himself.',
      exp: '四个孩子去掉积及自己，剩下 3 个：1 个哥哥或弟弟、2 个姐妹。', expe: 'Four children minus Jacob himself leaves 3: one brother and two sisters.',
      howto: '问「有几个兄弟姊妹」时，先算全家孩子，再减去自己。', howtoe: 'Count all the children, then take away the person being asked about.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q2', fig: 'timo_fig/k17-q2.png', a: '方块', ans: 'choice', opts: ['圆', '三角', '方块'], optse: ['circle', 'triangle', 'square'],
      q: '看图：第一个天秤，2 个方块和 3 个三角一样重；第二个天秤，1 个三角和 3 个圆一样重。哪个最重？',
      qy: '睇图：第一个天秤，2 个方块同 3 个三角一样重；第二个天秤，1 个三角同 3 个圆一样重。边个最重？',
      qe: 'Look at the picture: 2 squares balance 3 triangles, and 1 triangle balances 3 circles. Which is the heaviest?',
      hint: '个数少的那边，每一个更重。', hinty: '个数少嗰边，每一个更重。', hinte: 'On a balanced scale, the side with fewer pieces has heavier pieces.',
      exp: '2 个方块抵 3 个三角，所以方块比三角重；1 个三角抵 3 个圆，所以三角比圆重。方块最重。', expe: '2 squares balance 3 triangles, so a square is heavier than a triangle; 1 triangle balances 3 circles, so a triangle is heavier than a circle. The square is heaviest.',
      howto: '天秤平衡时，个数少的那种更重；两台天秤连起来排顺序。', howtoe: 'When balanced, fewer pieces means heavier pieces. Chain the two scales to rank them.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q3', fig: 'timo_fig/k17-q3.png', a: '6', ans: 'num',
      q: '看图：数字排成三角形，方格里是什么数？', qy: '睇图：啲数字排成三角形，方格入面系咩数？', qe: 'Look at the number triangle. What number goes in the box?',
      hint: '每个数等于它头上两个数加起来。', hinty: '每个数等于佢头顶两个数加埋。', hinte: 'Each number is the sum of the two numbers just above it.',
      exp: '方格头上是 3 和 3，3 加 3 等于 6。', expe: 'The two numbers above the box are 3 and 3, and 3 + 3 = 6.',
      howto: '数字三角形先看一个数和它上面两个数的关系，再用到空格上。', howtoe: 'Find how a number relates to the two above it, then use that rule for the box.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q4', show: '1, 1, 2, 3, 5, 8, __', a: '13', ans: 'num',
      q: '按规律：1、1、2、3、5、8，下一个是多少？', qy: '跟规律：1、1、2、3、5、8，下一个系几多？', qe: 'Pattern: 1, 1, 2, 3, 5, 8. What comes next?',
      hint: '把前面两个数加起来看看。', hinty: '试下将前面两个数加埋。', hinte: 'Try adding the two numbers before it.',
      exp: '每个数是前面两个数之和：5 加 8 等于 13。', expe: 'Each number is the sum of the two before it: 5 + 8 = 13.',
      howto: '规律题先算相邻两数的差；差在变，就试试前两个数相加。', howtoe: 'Check the differences first; if they keep changing, try adding the two previous numbers.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2017-heat-Kindergarten Q5', fig: 'timo_fig/k17-q5.png', a: '24', ans: 'num',
      q: '看图：每组是一圈打叉的格子，第 1 组 1 个，第 2 组 8 个，第 3 组 16 个。第 4 组（7 乘 7 的方格最外一圈）有多少个？',
      qy: '睇图：每组系一圈打交叉嘅格，第 1 组 1 个，第 2 组 8 个，第 3 组 16 个。第 4 组（7 乘 7 嘅方格最外一圈）有几多个？',
      qe: 'Look at the picture: each group is the outer ring of a square grid: 1, 8, 16. How many marks in the 4th group, the outer ring of a 7 by 7 grid?',
      hint: '一圈有 4 条边，每条边 7 格，四个角不要数两次。', hinty: '一圈有 4 条边，每条边 7 格，四个角唔好数两次。', hinte: 'A ring has 4 sides of 7, but do not count the 4 corners twice.',
      exp: '每组比上一组多 8 个：1、8、16，再加 8 是 24。也可以算 7 乘 4 减 4 个角等于 24。', expe: 'Each group adds 8: 1, 8, 16, then 24. Or 4 sides of 7 is 28, minus the 4 corners counted twice: 24.',
      howto: '数一圈的格子：边长乘 4，再减去重复的 4 个角。', howtoe: 'For a ring: side length times 4, minus the 4 corners counted twice.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q6', show: '3 + 3 + 3 + 3 + 3', a: '15', ans: 'num',
      q: '3 加 3 加 3 加 3 加 3 等于多少？', qy: '3 加 3 加 3 加 3 加 3 等于几多？', qe: 'What is 3 + 3 + 3 + 3 + 3?',
      hint: '3 个 3 是 9，再加两个 3。', hinty: '3 个 3 系 9，再加两个 3。', hinte: 'Three 3s make 9. Add two more 3s.',
      exp: '3、6、9、12、15，五个 3 是 15。', expe: 'Count by threes: 3, 6, 9, 12, 15.',
      howto: '同一个数连加，可以一个一个跳着数，数清加了几次。', howtoe: 'For repeated adding, skip-count and keep track of how many times.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q7', show: '17 − 8 − 7', a: '2', ans: 'num',
      q: '17 减 8 再减 7 等于多少？', qy: '17 减 8 再减 7 等于几多？', qe: 'What is 17 − 8 − 7?',
      hint: '先算 17 减 8。', hinty: '先计 17 减 8。', hinte: 'Start with 17 − 8.',
      exp: '17 减 8 等于 9，9 减 7 等于 2。', expe: '17 − 8 = 9, and 9 − 7 = 2.',
      howto: '连减从左到右一步一步算，每步写下中间的数。', howtoe: 'Subtract left to right, one step at a time.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q8', show: '12 − A = 8', a: '4', ans: 'num',
      q: 'A 是一位数，12 减 A 等于 8，A 是多少？', qy: 'A 系一位数，12 减 A 等于 8，A 系几多？', qe: 'A is a 1-digit number and 12 − A = 8. What is A?',
      hint: '想：12 减几等于 8？', hinty: '谂下：12 减几等于 8？', hinte: 'What do you take from 12 to leave 8?',
      exp: '12 减 8 等于 4，所以 A 是 4。验算：12 减 4 等于 8。', expe: '12 − 8 = 4, so A = 4. Check: 12 − 4 = 8.',
      howto: '求减去的数：用大数减结果，再代回去验算。', howtoe: 'The missing number is start minus result; put it back in to check.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q9', show: '14 + 11 + 8', a: '33', ans: 'num',
      q: '14 加 11 加 8 等于多少？', qy: '14 加 11 加 8 等于几多？', qe: 'What is 14 + 11 + 8?',
      hint: '先算 14 加 11。', hinty: '先计 14 加 11。', hinte: 'First do 14 + 11.',
      exp: '14 加 11 等于 25，25 加 8 等于 33。', expe: '14 + 11 = 25, and 25 + 8 = 33.',
      howto: '连加先算容易的一步，记住中间结果再加下一个。', howtoe: 'Add step by step and remember the middle answer.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2017-heat-Kindergarten Q10', show: '37 + A = 40', a: '3', ans: 'num',
      q: 'A 是一位数，37 加 A 等于 40，A 是多少？', qy: 'A 系一位数，37 加 A 等于 40，A 系几多？', qe: 'A is a 1-digit number and 37 + A = 40. What is A?',
      hint: '从 37 往上数到 40。', hinty: '由 37 向上数到 40。', hinte: 'Count up from 37 to 40.',
      exp: '38、39、40，数了 3 下，A 是 3。', expe: '38, 39, 40: three steps, so A = 3.',
      howto: '求加上的数：用和减去已知的数，或者往上数。', howtoe: 'The missing addend is total minus the known number, or count up.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q11', a: '4', ans: 'num',
      q: '艾美有 8 个苹果，约翰一个都没有。要让两人苹果一样多，艾美要给约翰多少个？', qy: '艾美有 8 个苹果，约翰一个都冇。要两个人一样多，艾美要畀约翰几多个？',
      qe: 'Amy has 8 apples and John has none. How many must Amy give John so they have the same?',
      hint: '8 个分成一样多的两份，每份几个？', hinty: '8 个分成一样多嘅两份，每份几个？', hinte: 'Split 8 into two equal shares.',
      exp: '8 个平分两人，每人 4 个，所以艾美给约翰 4 个。', expe: '8 shared by two is 4 each, so Amy gives John 4.',
      howto: '给到一样多：先算两人一共多少、每人应得多少，再看要给几个。', howtoe: 'Find the total, halve it, then see how many must move.' },
    Object.assign({ lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q12', ans: 'choice',
      q: '在 2、3、4、5 中间填加号或减号，使结果等于 14。哪一条算式对？', qy: '喺 2、3、4、5 中间填加号或者减号，令结果等于 14。边一条算式啱？',
      qe: 'Put + or − between 2, 3, 4, 5 to make 14. Which one is right?',
      hint: '每条算式都算一算，看哪条等于 14。', hinty: '每条算式都计下，睇边条等于 14。', hinte: 'Work out each one and find the one that makes 14.',
      exp: '2 加 3 加 4 加 5 等于 14，全部是加号。', expe: '2 + 3 + 4 + 5 = 14, all plus signs.',
      howto: '先全部用加号算一次：太大了就把某个加号换成减号，结果会少两倍那个数。', howtoe: 'Try all plus signs first; changing a + to − lowers the total by twice that number.' }, signs([2, 3, 4, 5], 14)),
    Object.assign({ lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q13', ans: 'choice',
      q: '在 5、4、3 中间填加号或减号，使结果等于 4。哪一条算式对？', qy: '喺 5、4、3 中间填加号或者减号，令结果等于 4。边一条算式啱？',
      qe: 'Put + or − between 5, 4, 3 to make 4. Which one is right?',
      hint: '每条算式都算一算，看哪条等于 4。', hinty: '每条算式都计下，睇边条等于 4。', hinte: 'Work out each one and find the one that makes 4.',
      exp: '5 减 4 等于 1，1 加 3 等于 4。', expe: '5 − 4 = 1, then 1 + 3 = 4.',
      howto: '全部用加号是 12，比 4 大 8；把 4 前面的加号换成减号，正好少 8。', howtoe: 'All plus gives 12, which is 8 too many; turning +4 into −4 removes exactly 8.' }, signs([5, 4, 3], 4)),
    { lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q14', show: '12 − A = 5 + 4', a: '3', ans: 'num',
      q: 'A 是一位数，12 减 A 等于 5 加 4，A 是多少？', qy: 'A 系一位数，12 减 A 等于 5 加 4，A 系几多？', qe: 'A is a 1-digit number and 12 − A = 5 + 4. What is A?',
      hint: '先算右边 5 加 4。', hinty: '先计右边 5 加 4。', hinte: 'Work out 5 + 4 first.',
      exp: '5 加 4 等于 9；12 减 A 等于 9，所以 A 是 3。', expe: '5 + 4 = 9, and 12 − A = 9, so A = 3.',
      howto: '等号两边一样大：先把能算的一边算出来，再求 A。', howtoe: 'Both sides are equal: work out the known side first, then find A.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2017-heat-Kindergarten Q15', show: '13, 11, 9, 7, __', a: '5', ans: 'num',
      q: '按规律：13、11、9、7，下一个是多少？', qy: '跟规律：13、11、9、7，下一个系几多？', qe: 'Pattern: 13, 11, 9, 7. What comes next?',
      hint: '每次少了几个？', hinty: '每次少咗几多？', hinte: 'How much smaller is each number?',
      exp: '每次减 2，7 减 2 等于 5。', expe: 'Each time it goes down by 2: 7 − 2 = 5.',
      howto: '数列先算相邻两个数差多少，再用这个差往下推。', howtoe: 'Find the gap between neighbours, then carry it on.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2017-heat-Kindergarten Q16', fig: 'timo_fig/k17-q16.png', a: '6', ans: 'num',
      q: '看图：图中一共有多少个正方形？大的小的都要数。', qy: '睇图：图入面一共有几多个正方形？大嘅细嘅都要数。', qe: 'Look at the picture. How many squares are there, big and small?',
      hint: '先数小格，再找由 4 个小格拼成的大正方形。', hinty: '先数细格，再搵由 4 个细格拼成嘅大正方形。', hinte: 'Count the small squares, then look for big ones made of 4 small squares.',
      exp: '小正方形 5 个，左边 4 个小格拼成 1 个大正方形，一共 6 个。', expe: '5 small squares plus 1 big square made of 4 small ones: 6.',
      howto: '数图形要分大小：先数最小的，再数两格乘两格的，最后加起来。', howtoe: 'Count by size: smallest first, then 2 by 2, then add them up.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2017-heat-Kindergarten Q18', fig: 'timo_fig/k17-q18.png', a: '6', ans: 'num',
      q: '看图：这个多边形有多少条边？', qy: '睇图：呢个多边形有几多条边？', qe: 'Look at the picture. How many sides does this polygon have?',
      hint: '从一条边开始，用手指沿着边数一圈。', hinty: '由一条边开始，用手指沿住边数一圈。', hinte: 'Start at one side and trace around with your finger.',
      exp: '这是六边形，一共 6 条边。', expe: 'It is a hexagon with 6 sides.',
      howto: '数边：先在起点做记号，沿着走一圈回到起点为止。', howtoe: 'Mark where you start and go once around.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2017-heat-Kindergarten Q19', fig: 'timo_fig/k17-q19.png', a: '7', ans: 'num',
      q: '看图：这个箭头形状有多少只角？', qy: '睇图：呢个箭咀形有几多只角？', qe: 'Look at the arrow shape. How many angles does it have?',
      hint: '每两条边相交的地方就是一只角，顺着边数。', hinty: '每两条边相交嘅地方就系一只角，跟住边数。', hinte: 'Every corner where two sides meet is an angle. Go around and count.',
      exp: '箭头尖 1 只，两边肩膀各 2 只，底下 2 只，一共 7 只角。', expe: '1 at the tip, 2 on each shoulder, 2 at the bottom: 7 angles.',
      howto: '多边形的角数和边数一样多，可以数边来验算。', howtoe: 'A polygon has as many angles as sides, so count the sides to check.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2017-heat-Kindergarten Q20', show: '○ □ △ ○ □ △ ○ __ △', a: '方', ans: 'choice', opts: SHAPE.opts, optse: SHAPE.optse,
      q: '按规律：圆、方、三角、圆、方、三角、圆、空格、三角。空格是什么？', qy: '跟规律：圆、方、三角、圆、方、三角、圆、空格、三角。空格系咩？',
      qe: 'Pattern: circle, square, triangle, circle, square, triangle, circle, blank, triangle. What is the blank?',
      hint: '三个一组：圆、方、三角。', hinty: '三个一组：圆、方、三角。', hinte: 'It repeats in threes: circle, square, triangle.',
      exp: '圆后面总是方，所以空格是方。', expe: 'A square always comes after a circle.',
      howto: '图形规律先找重复的一组，再看空格在组里第几个。', howtoe: 'Find the repeating block, then see where the blank falls in it.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q21', show: '☆☆☆☆☆☆☆☆☆☆', a: '5', ans: 'num',
      q: '把 10 颗星分成一样多的两份，每份多少颗？', qy: '将 10 粒星分成一样多嘅两份，每份几多粒？', qe: 'Split 10 stars into 2 equal groups. How many in each group?',
      hint: '一颗给左边、一颗给右边，轮流分。', hinty: '一粒畀左边、一粒畀右边，轮流分。', hinte: 'Give one to each side in turn.',
      exp: '10 的一半是 5，每份 5 颗。', expe: 'Half of 10 is 5.',
      howto: '分成两等份就是找一半：哪个数加自己等于总数。', howtoe: 'Two equal groups means half: which number added to itself makes the total?' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q22', show: '1, 2, 3, 6, 11, 20, 37, 68', a: '4', ans: 'num',
      q: '1、2、3、6、11、20、37、68 里有多少个单数（奇数）？', qy: '1、2、3、6、11、20、37、68 入面有几多个单数？', qe: 'How many odd numbers are in 1, 2, 3, 6, 11, 20, 37, 68?',
      hint: '只看个位：1、3、5、7、9 是单数。', hinty: '淨系睇个位：1、3、5、7、9 系单数。', hinte: 'Look only at the last digit: 1, 3, 5, 7, 9 are odd.',
      exp: '单数是 1、3、11、37，一共 4 个。', expe: 'The odd ones are 1, 3, 11, 37: four.',
      howto: '判断单双数只看个位，逐个打勾数。', howtoe: 'Odd or even depends on the last digit only; tick them one by one.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q23', show: '1, 4, 5, 9, 14, 23, 37, 60', a: '3', ans: 'num',
      q: '1、4、5、9、14、23、37、60 里有多少个双数（偶数）？', qy: '1、4、5、9、14、23、37、60 入面有几多个双数？', qe: 'How many even numbers are in 1, 4, 5, 9, 14, 23, 37, 60?',
      hint: '只看个位：0、2、4、6、8 是双数。', hinty: '淨系睇个位：0、2、4、6、8 系双数。', hinte: 'Look only at the last digit: 0, 2, 4, 6, 8 are even.',
      exp: '双数是 4、14、60，一共 3 个。', expe: 'The even ones are 4, 14, 60: three.',
      howto: '判断单双数只看个位，逐个打勾数。', howtoe: 'Odd or even depends on the last digit only; tick them one by one.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q24', a: '421', ans: 'num',
      q: '用 1、2、4 三个数字各用一次，组成最大的三位数是多少？', qy: '用 1、2、4 三个数字每个用一次，组成最大嘅三位数系几多？', qe: 'Use 1, 2 and 4 once each. What is the largest 3-digit number?',
      hint: '最大的数字放最前面。', hinty: '最大嘅数字放最前面。', hinte: 'Put the biggest digit first.',
      exp: '从大到小排：4、2、1，就是 421。', expe: 'Biggest to smallest: 4, 2, 1 makes 421.',
      howto: '组最大的数：数字从大到小排；组最小的数：从小到大排。', howtoe: 'Largest number: digits from big to small. Smallest: small to big.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2017-heat-Kindergarten Q25', a: '24', ans: 'num',
      q: '彼得有 4 个 1 元、2 个 5 元和 1 个 10 元硬币，他最多能买多少元的纪念品？', qy: '彼得有 4 个一蚊、2 个五蚊同 1 个十蚊，佢最多可以买几多蚊嘅纪念品？',
      qe: 'Peter has four $1 coins, two $5 coins and one $10 coin. What is the most a souvenir can cost for him to buy it?',
      hint: '最多能买多少，就是全部钱加起来。', hinty: '最多买几多，即系全部钱加埋。', hinte: 'The most he can pay is all his money added up.',
      exp: '4 个 1 元是 4 元，2 个 5 元是 10 元，再加 10 元：4 加 10 加 10 等于 24 元。', expe: '$4 + $10 + $10 = $24.',
      howto: '数钱：同一种硬币先合起来，再把几种加在一起。', howtoe: 'Group the same coins first, then add the groups.' },

    /* ================= TIMO-2018-final-Kindergarten ================= */
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q1', a: '5', ans: 'num',
      q: '积及是家里最小的男孩，他有 4 个姐姐，没有兄弟。积及家一共有多少个孩子？', qy: '积及系屋企最细嘅男仔，佢有 4 个家姐，冇兄弟。积及屋企一共有几多个细路？',
      qe: "Jacob is the youngest boy in the family. He has 4 elder sisters and no brothers. How many children are in Jacob's family?",
      hint: '别忘了算积及自己。', hinty: '唔好漏咗积及自己。', hinte: 'Remember to count Jacob himself.',
      exp: '4 个姐姐加积及自己，一共 5 个孩子。', expe: '4 sisters plus Jacob makes 5 children.',
      howto: '问「家里一共几个孩子」要把自己也算进去。', howtoe: 'When counting the whole family, include the person in the question.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q2', fig: 'timo_fig/k18-q2.png', a: '圆', ans: 'choice', opts: ['圆', '三角', '方块'], optse: ['circle', 'triangle', 'square'],
      q: '看图：第一个天秤，1 个方块和 3 个三角一样重；第二个天秤，1 个三角和 2 个圆一样重。哪个最轻？',
      qy: '睇图：第一个天秤，1 个方块同 3 个三角一样重；第二个天秤，1 个三角同 2 个圆一样重。边个最轻？',
      qe: 'Look at the picture: 1 square balances 3 triangles, and 1 triangle balances 2 circles. Which is the lightest?',
      hint: '个数多的那边，每一个更轻。', hinty: '个数多嗰边，每一个更轻。', hinte: 'On a balanced scale, the side with more pieces has lighter pieces.',
      exp: '3 个三角才抵 1 个方块，三角比方块轻；2 个圆才抵 1 个三角，圆比三角轻。圆最轻。', expe: 'It takes 3 triangles to balance a square, and 2 circles to balance a triangle, so the circle is lightest.',
      howto: '天秤平衡时，个数多的那种更轻；两台天秤连起来排顺序。', howtoe: 'When balanced, more pieces means lighter pieces. Chain the two scales.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q3', show: 'A, C, E, G, I, __', a: 'K', ans: 'choice', opts: ['J', 'K', 'L', 'M'],
      q: '按规律：A、C、E、G、I，下一个字母是什么？', qy: '跟规律：A、C、E、G、I，下一个字母系咩？', qe: 'Pattern: A, C, E, G, I. What letter comes next?',
      hint: '字母表里每次跳过一个字母。', hinty: '字母表入面每次跳过一个字母。', hinte: 'One letter is skipped each time.',
      exp: 'A 跳过 B 到 C，I 跳过 J 就是 K。', expe: 'A skips B to C; I skips J to K.',
      howto: '字母规律：把字母表念出来，看每次跳几个。', howtoe: 'Say the alphabet and see how many letters are skipped.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q4', show: '1, 8, 3, 6, 5, 4, __', a: '7', ans: 'num',
      q: '按规律：1、8、3、6、5、4，下一个是多少？', qy: '跟规律：1、8、3、6、5、4，下一个系几多？', qe: 'Pattern: 1, 8, 3, 6, 5, 4. What comes next?',
      hint: '隔一个看：1、3、5 和 8、6、4。', hinty: '隔一个睇：1、3、5 同 8、6、4。', hinte: 'Look at every other number: 1, 3, 5 and 8, 6, 4.',
      exp: '单数位置是 1、3、5，每次加 2，下一个是 7。', expe: 'The 1st, 3rd, 5th numbers go 1, 3, 5, so the next is 7.',
      howto: '一串数忽大忽小时，试试把它拆成隔一个的两串。', howtoe: 'If numbers jump up and down, split them into two alternating lists.' },
    { lv: 'k2', sec: '逻辑', src: 'TIMO-2018-final-Kindergarten Q5', fig: 'timo_fig/k18-q5.png', a: '14', ans: 'num',
      q: '看图：第 1 组 1 个，第 2 组 6 个，第 3 组 10 个，都打在最上和最下两行。第 4 组（每行 7 格）有多少个？',
      qy: '睇图：第 1 组 1 个，第 2 组 6 个，第 3 组 10 个，都系最上同最下两行。第 4 组（每行 7 格）有几多个？',
      qe: 'Look at the picture: groups have 1, 6, 10 marks in the top and bottom rows. How many in group 4, with 7 squares in each row?',
      hint: '上面一行 7 个，下面一行也 7 个。', hinty: '上面一行 7 个，下面一行都 7 个。', hinte: 'The top row has 7 and the bottom row has 7.',
      exp: '每行 7 个，两行就是 7 加 7 等于 14。', expe: 'Two rows of 7: 7 + 7 = 14.',
      howto: '图形规律先看每组怎么变大，再算下一组。', howtoe: 'See how each group grows, then build the next one.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q6', show: '2 + 2 + 2 + 2 + 2', a: '10', ans: 'num',
      q: '2 加 2 加 2 加 2 加 2 等于多少？', qy: '2 加 2 加 2 加 2 加 2 等于几多？', qe: 'What is 2 + 2 + 2 + 2 + 2?',
      hint: '两个两个数：2、4、6……', hinty: '两个两个数：2、4、6……', hinte: 'Count by twos: 2, 4, 6...',
      exp: '2、4、6、8、10，五个 2 是 10。', expe: 'Count by twos five times: 10.',
      howto: '同一个数连加，可以跳着数，数清加了几次。', howtoe: 'Skip-count and keep track of how many times.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q7', show: '18 − 6 − 8', a: '4', ans: 'num',
      q: '18 减 6 再减 8 等于多少？', qy: '18 减 6 再减 8 等于几多？', qe: 'What is 18 − 6 − 8?',
      hint: '先算 18 减 6。', hinty: '先计 18 减 6。', hinte: 'Start with 18 − 6.',
      exp: '18 减 6 等于 12，12 减 8 等于 4。', expe: '18 − 6 = 12, and 12 − 8 = 4.',
      howto: '连减从左到右一步一步算。', howtoe: 'Subtract left to right, one step at a time.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q8', show: '10 − A = 3', a: '7', ans: 'num',
      q: 'A 是一位数，10 减 A 等于 3，A 是多少？', qy: 'A 系一位数，10 减 A 等于 3，A 系几多？', qe: 'A is a 1-digit number and 10 − A = 3. What is A?',
      hint: '想：10 减几还剩 3？', hinty: '谂下：10 减几仲剩 3？', hinte: 'What do you take from 10 to leave 3?',
      exp: '10 减 3 等于 7，所以 A 是 7。', expe: '10 − 3 = 7, so A = 7.',
      howto: '求减去的数：用大数减结果，再代回去验算。', howtoe: 'The missing number is start minus result; check by putting it back.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q9', show: '10 − 9 + 8 − 7 + 6 − 5 + 4 − 3 + 2 − 1', a: '5', ans: 'num',
      q: '10 减 9 加 8 减 7 加 6 减 5 加 4 减 3 加 2 减 1 等于多少？', qy: '10 减 9 加 8 减 7 加 6 减 5 加 4 减 3 加 2 减 1 等于几多？',
      qe: 'What is 10 − 9 + 8 − 7 + 6 − 5 + 4 − 3 + 2 − 1?',
      hint: '两个两个看：10 减 9 是多少？8 减 7 呢？', hinty: '两个两个睇：10 减 9 系几多？8 减 7 呢？', hinte: 'Pair them: what is 10 − 9? And 8 − 7?',
      exp: '每一对都等于 1：10−9、8−7、6−5、4−3、2−1，一共 5 对，所以是 5。', expe: 'Each pair (10−9, 8−7, 6−5, 4−3, 2−1) is 1, and there are 5 pairs: 5.',
      howto: '长算式先找能配成一对的，每对结果一样就数有几对。', howtoe: 'Look for pairs with the same result, then count the pairs.' },
    { lv: 'k2', sec: '算术', src: 'TIMO-2018-final-Kindergarten Q10', show: '12 + A = 20', a: '8', ans: 'num',
      q: 'A 是一位数，12 加 A 等于 20，A 是多少？', qy: 'A 系一位数，12 加 A 等于 20，A 系几多？', qe: 'A is a 1-digit number and 12 + A = 20. What is A?',
      hint: '从 12 往上数到 20。', hinty: '由 12 向上数到 20。', hinte: 'Count up from 12 to 20.',
      exp: '20 减 12 等于 8，所以 A 是 8。', expe: '20 − 12 = 8, so A = 8.',
      howto: '求加上的数：用和减去已知的数。', howtoe: 'The missing addend is total minus the known number.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q11', a: '3', ans: 'num',
      q: '艾美有 7 个梨，约翰有 1 个。要让两人一样多，艾美要给约翰多少个？', qy: '艾美有 7 个梨，约翰有 1 个。要两个人一样多，艾美要畀约翰几多个？',
      qe: 'Amy has 7 pears and John has 1. How many must Amy give John so they have the same?',
      hint: '两人一共几个？一样多的话每人几个？', hinty: '两个人一共几个？一样多嘅话每人几个？', hinte: 'How many altogether? How many each if equal?',
      exp: '一共 8 个，一样多每人 4 个；约翰有 1 个，还差 3 个，所以给 3 个。', expe: '8 altogether means 4 each. John has 1, so Amy gives 3.',
      howto: '给到一样多：总数除以 2 是每人应得的，再看少的那个还差几个。', howtoe: 'Half of the total is each share; see how many the smaller one is missing.' },
    Object.assign({ lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q12', ans: 'choice',
      q: '在 2、4、3、1 中间填加号或减号，使结果等于 10。哪一条算式对？', qy: '喺 2、4、3、1 中间填加号或者减号，令结果等于 10。边一条算式啱？',
      qe: 'Put + or − between 2, 4, 3, 1 to make 10. Which one is right?',
      hint: '每条算式都算一算，看哪条等于 10。', hinty: '每条算式都计下，睇边条等于 10。', hinte: 'Work out each one and find the one that makes 10.',
      exp: '2 加 4 加 3 加 1 等于 10，全部是加号。', expe: '2 + 4 + 3 + 1 = 10, all plus signs.',
      howto: '先全部用加号算一次，太大了再把某个加号换成减号。', howtoe: 'Try all plus first; if too big, change one + to −.' }, signs([2, 4, 3, 1], 10)),
    Object.assign({ lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q13', ans: 'choice',
      q: '在 6、1、3 中间填加号或减号，使结果等于 2。哪一条算式对？', qy: '喺 6、1、3 中间填加号或者减号，令结果等于 2。边一条算式啱？',
      qe: 'Put + or − between 6, 1, 3 to make 2. Which one is right?',
      hint: '结果比 6 小很多，要减掉不少。', hinty: '结果细过 6 好多，要减走唔少。', hinte: 'The answer is much smaller than 6, so you need to take away.',
      exp: '6 减 1 等于 5，5 减 3 等于 2。', expe: '6 − 1 = 5, then 5 − 3 = 2.',
      howto: '目标比第一个数小，就多用减号试。', howtoe: 'If the target is smaller than the first number, try more minus signs.' }, signs([6, 1, 3], 2)),
    { lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q14', show: '11 − A = 4 + 3', a: '4', ans: 'num',
      q: 'A 是一位数，11 减 A 等于 4 加 3，A 是多少？', qy: 'A 系一位数，11 减 A 等于 4 加 3，A 系几多？', qe: 'A is a 1-digit number and 11 − A = 4 + 3. What is A?',
      hint: '先算右边 4 加 3。', hinty: '先计右边 4 加 3。', hinte: 'Work out 4 + 3 first.',
      exp: '4 加 3 等于 7；11 减 A 等于 7，所以 A 是 4。', expe: '4 + 3 = 7, and 11 − A = 7, so A = 4.',
      howto: '等号两边一样大：先算能算的一边，再求 A。', howtoe: 'Work out the known side first, then find A.' },
    { lv: 'k2', sec: '数论', src: 'TIMO-2018-final-Kindergarten Q15', show: '10, 7, 4, __', a: '1', ans: 'num',
      q: '按规律：10、7、4，下一个是多少？', qy: '跟规律：10、7、4，下一个系几多？', qe: 'Pattern: 10, 7, 4. What comes next?',
      hint: '每次少了几个？', hinty: '每次少咗几多？', hinte: 'How much smaller is each number?',
      exp: '每次减 3，4 减 3 等于 1。', expe: 'Each time it goes down by 3: 4 − 3 = 1.',
      howto: '数列先算相邻两个数差多少，再往下推。', howtoe: 'Find the gap between neighbours, then carry it on.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2018-final-Kindergarten Q16', fig: 'timo_fig/k18-q16.png', a: '5', ans: 'num',
      q: '看图：图中一共有多少个正方形？大的小的都要数。', qy: '睇图：图入面一共有几多个正方形？大嘅细嘅都要数。', qe: 'Look at the picture. How many squares are there, big and small?',
      hint: '先数小格，再看有没有 4 个小格拼成的大正方形。', hinty: '先数细格，再睇有冇 4 个细格拼成嘅大正方形。', hinte: 'Count the small squares, then check for a big one made of 4.',
      exp: '小正方形 5 个；上面中间缺了一格，拼不成大正方形，所以一共 5 个。', expe: '5 small squares. The top middle is missing, so no big square can be made: 5.',
      howto: '数图形要分大小：先数最小的，再一个个检查大的是否完整。', howtoe: 'Count by size and check each bigger square is complete.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2018-final-Kindergarten Q18', fig: 'timo_fig/k18-q18.png', a: '6', ans: 'num',
      q: '看图：这个图形有多少条线段？', qy: '睇图：呢个图形有几多条线段？', qe: 'Look at the picture. How many line segments does this shape have?',
      hint: '两个黑点之间的一条线就是一条线段。', hinty: '两粒黑点之间嘅一条线就系一条线段。', hinte: 'Each line between two dots is one segment.',
      exp: '图形有 6 个黑点，围成一圈，一共 6 条线段。', expe: 'There are 6 dots going around, so 6 segments.',
      howto: '数线段：从一个点出发绕一圈，每过一条线数一下。', howtoe: 'Start at one dot and go round, counting each line.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2018-final-Kindergarten Q19', fig: 'timo_fig/k18-q19.png', a: '5', ans: 'num',
      q: '看图：图中一共有多少个三角形？大的小的都要数。', qy: '睇图：图入面一共有几多个三角形？大嘅细嘅都要数。', qe: 'Look at the picture. How many triangles are there, big and small?',
      hint: '先数小三角形，再看整个大三角形。', hinty: '先数细三角形，再睇成个大三角形。', hinte: 'Count the small triangles, then the whole big one.',
      exp: '小三角形 4 个，加上整个大三角形 1 个，一共 5 个。', expe: '4 small triangles plus the big one: 5.',
      howto: '数三角形分大小：先数最小的，再数由几个小的拼成的。', howtoe: 'Count the smallest first, then the ones made from several small ones.' },
    { lv: 'k2', sec: '几何', src: 'TIMO-2018-final-Kindergarten Q20', show: '□ ○ △ □ ○ △ □ __ △', a: '圆', ans: 'choice', opts: SHAPE.opts, optse: SHAPE.optse,
      q: '按规律：方、圆、三角、方、圆、三角、方、空格、三角。空格是什么？', qy: '跟规律：方、圆、三角、方、圆、三角、方、空格、三角。空格系咩？',
      qe: 'Pattern: square, circle, triangle, square, circle, triangle, square, blank, triangle. What is the blank?',
      hint: '三个一组：方、圆、三角。', hinty: '三个一组：方、圆、三角。', hinte: 'It repeats in threes: square, circle, triangle.',
      exp: '方后面总是圆，所以空格是圆。', expe: 'A circle always comes after a square.',
      howto: '图形规律先找重复的一组，再看空格在组里第几个。', howtoe: 'Find the repeating block, then see where the blank falls.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q21', show: '☆☆☆☆☆☆☆☆', a: '4', ans: 'num',
      q: '把 8 颗星分成一样多的两份，每份多少颗？', qy: '将 8 粒星分成一样多嘅两份，每份几多粒？', qe: 'Split 8 stars into 2 equal groups. How many in each group?',
      hint: '一颗给左边、一颗给右边，轮流分。', hinty: '一粒畀左边、一粒畀右边，轮流分。', hinte: 'Give one to each side in turn.',
      exp: '8 的一半是 4，每份 4 颗。', expe: 'Half of 8 is 4.',
      howto: '分成两等份就是找一半：哪个数加自己等于总数。', howtoe: 'Two equal groups means half.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q22', show: '1+3, 2+4, 3+5, 8+4, 2+5, 2+4', a: '1', ans: 'num',
      q: '1 加 3、2 加 4、3 加 5、8 加 4、2 加 5、2 加 4，这些算式的答案里有多少个单数？', qy: '1 加 3、2 加 4、3 加 5、8 加 4、2 加 5、2 加 4，呢啲算式嘅答案入面有几多个单数？',
      qe: 'Work out 1+3, 2+4, 3+5, 8+4, 2+5, 2+4. How many of the answers are odd?',
      hint: '先把每个答案算出来，再看个位。', hinty: '先计晒每个答案，再睇个位。', hinte: 'Work out every answer first, then check the last digit.',
      exp: '答案是 4、6、8、12、7、6，只有 7 是单数，所以 1 个。', expe: 'The answers are 4, 6, 8, 12, 7, 6. Only 7 is odd.',
      howto: '先全部算出来写好，再一个个判断，不要边算边猜。', howtoe: 'Write all the answers down first, then check each one.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q23', show: '14+3, 4+5, 7+9, 1+8, 3+5', a: '3', ans: 'num',
      q: '14 加 3、4 加 5、7 加 9、1 加 8、3 加 5，这些算式的答案里有多少个一位数？', qy: '14 加 3、4 加 5、7 加 9、1 加 8、3 加 5，呢啲算式嘅答案入面有几多个一位数？',
      qe: 'Work out 14+3, 4+5, 7+9, 1+8, 3+5. How many of the answers are 1-digit numbers?',
      hint: '一位数就是 0 到 9。', hinty: '一位数即系 0 到 9。', hinte: '1-digit numbers are 0 to 9.',
      exp: '答案是 17、9、16、9、8，一位数有 9、9、8，一共 3 个。', expe: 'The answers are 17, 9, 16, 9, 8. The 1-digit ones are 9, 9, 8: three.',
      howto: '先全部算出来，再数符合条件的。', howtoe: 'Work everything out, then count the ones that fit.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q24', show: '2, 14, 15, 27, 4, 32, 47', a: '5', ans: 'num',
      q: '2、14、15、27、4、32、47 里有多少个两位数？', qy: '2、14、15、27、4、32、47 入面有几多个两位数？', qe: 'How many 2-digit numbers are in 2, 14, 15, 27, 4, 32, 47?',
      hint: '两位数有十位和个位，像 14。', hinty: '两位数有十位同个位，好似 14。', hinte: 'A 2-digit number has tens and ones, like 14.',
      exp: '两位数是 14、15、27、32、47，一共 5 个。', expe: '14, 15, 27, 32, 47: five.',
      howto: '逐个看是几位数，打勾再数。', howtoe: 'Check each number and tick the 2-digit ones.' },
    { lv: 'k2', sec: '组合', src: 'TIMO-2018-final-Kindergarten Q25', a: '3', ans: 'num',
      q: '彼得有 6 个 1 元硬币，可以换多少个 2 元硬币？', qy: '彼得有 6 个一蚊，可以换几多个两蚊？', qe: 'Peter has six $1 coins. How many $2 coins can he exchange them for?',
      hint: '两个 1 元换一个 2 元。', hinty: '两个一蚊换一个两蚊。', hinte: 'Two $1 coins make one $2 coin.',
      exp: '6 个 1 元两个两个分，分成 3 份，换 3 个 2 元。', expe: 'Group the six $1 coins in twos: 3 groups, so 3 coins.',
      howto: '换钱：看几个小的凑成一个大的，再分组数。', howtoe: 'See how many small coins make one big coin, then group them.' },

    /* ================= TIMO-2018-Primary-1（question paper，无答案页） ================= */
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q1', a: '8', ans: 'num',
      q: '积及是家里最大的男孩，他有 4 个妹妹和 3 个弟弟。积及家一共有多少个孩子？', qy: '积及系屋企最大嘅男仔，佢有 4 个妹妹同 3 个细佬。积及屋企一共有几多个细路？',
      qe: "Jacob is the eldest boy in the family and has 4 younger sisters and 3 younger brothers. How many children are in Jacob's family?",
      hint: '妹妹、弟弟，再加上积及自己。', hinty: '妹妹、细佬，再加积及自己。', hinte: 'Sisters, brothers, and Jacob himself.',
      exp: '4 个妹妹加 3 个弟弟是 7 个，再加积及自己，一共 8 个。', expe: '4 + 3 = 7, plus Jacob makes 8.',
      howto: '数家里的孩子，记得把题目里的人自己也算上。', howtoe: 'Include the person in the question when counting the family.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q2', a: '4', ans: 'num',
      q: '2018 年里，有多少个月刚好是 30 天？', qy: '2018 年入面，有几多个月啱啱系 30 日？', qe: 'In 2018, how many months have exactly 30 days?',
      hint: '用拳头数月份：凸起来的是大月 31 天，凹下去的是小月。', hinty: '用拳头数月份：凸起嘅系大月 31 日，凹落去嘅系小月。', hinte: 'Use the knuckle trick: knuckles are 31-day months.',
      exp: '30 天的月是 4 月、6 月、9 月、11 月，一共 4 个。2 月只有 28 天。', expe: 'April, June, September and November have 30 days: 4. February has 28.',
      howto: '记住口诀：四、六、九、十一是小月 30 天，二月特别。', howtoe: 'Remember: April, June, September, November have 30; February is special.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q3', a: '20', ans: 'num',
      q: '4 年前艾美 13 岁，3 年后艾美几岁？', qy: '4 年前艾美 13 岁，3 年后艾美几多岁？', qe: '4 years ago, Amy was 13 years old. How old will Amy be 3 years later?',
      hint: '先算艾美现在几岁。', hinty: '先计艾美而家几岁。', hinte: 'Work out how old Amy is now.',
      exp: '现在是 13 加 4 等于 17 岁，3 年后是 17 加 3 等于 20 岁。', expe: 'Now she is 13 + 4 = 17, so in 3 years she will be 20.',
      howto: '年龄题先换算到「现在」，再往前或往后算。', howtoe: 'Age questions: get to "now" first, then move forward or back.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q4', show: '1, 7, 13, 19, 25, __', a: '31', ans: 'num',
      q: '按规律：1、7、13、19、25，下一个是多少？', qy: '跟规律：1、7、13、19、25，下一个系几多？', qe: 'Pattern: 1, 7, 13, 19, 25. What comes next?',
      hint: '每次加了多少？', hinty: '每次加咗几多？', hinte: 'How much is added each time?',
      exp: '每次加 6，25 加 6 等于 31。', expe: 'Each time add 6: 25 + 6 = 31.',
      howto: '数列先算相邻两个数差多少，差固定就继续加。', howtoe: 'Find the constant gap and keep adding it.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2018-Primary-1 Q5', show: 'A, D, G, J, M, __', a: 'P', ans: 'choice', opts: ['N', 'O', 'P', 'Q'],
      q: '按规律：A、D、G、J、M，下一个字母是什么？', qy: '跟规律：A、D、G、J、M，下一个字母系咩？', qe: 'Pattern: A, D, G, J, M. What letter comes next?',
      hint: '每次跳过两个字母。', hinty: '每次跳过两个字母。', hinte: 'Two letters are skipped each time.',
      exp: 'A 跳过 B、C 到 D；M 跳过 N、O 就是 P。', expe: 'A skips B, C to D; M skips N, O to P.',
      howto: '字母规律：念字母表，数每次跳几个。', howtoe: 'Say the alphabet and count the jump.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q6', show: '2 + 3 + 5 + 6 + 8 + 9', a: '33', ans: 'num',
      q: '2 加 3 加 5 加 6 加 8 加 9 等于多少？', qy: '2 加 3 加 5 加 6 加 8 加 9 等于几多？', qe: 'What is 2 + 3 + 5 + 6 + 8 + 9?',
      hint: '找能凑成 10 或 11 的两个数先加。', hinty: '搵可以凑成 10 或者 11 嘅两个数先加。', hinte: 'Pair numbers that make 10 or 11 first.',
      exp: '2 加 9、3 加 8、5 加 6 都是 11，三个 11 是 33。', expe: '2 + 9, 3 + 8 and 5 + 6 are each 11; three 11s make 33.',
      howto: '一串连加先找配对：头尾配对，每对一样大就好算。', howtoe: 'Pair first with last; equal pairs make it easy.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q7', show: '27 + 18 − 17', a: '28', ans: 'num',
      q: '27 加 18 减 17 等于多少？', qy: '27 加 18 减 17 等于几多？', qe: 'What is 27 + 18 − 17?',
      hint: '先算 18 减 17 更容易。', hinty: '先计 18 减 17 会易啲。', hinte: 'It is easier to do 18 − 17 first.',
      exp: '18 减 17 等于 1，27 加 1 等于 28。', expe: '18 − 17 = 1, and 27 + 1 = 28.',
      howto: '加减混合时，先找能凑成整数或很小的数的两项。', howtoe: 'In mixed sums, look for two numbers that nearly cancel.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q8', show: '3 × A = 3 + 3 + 3 + 3 + 3', a: '5', ans: 'num',
      q: 'A 是一位数，3 乘 A 等于 3 加 3 加 3 加 3 加 3，A 是多少？', qy: 'A 系一位数，3 乘 A 等于 3 加 3 加 3 加 3 加 3，A 系几多？',
      qe: 'A is a 1-digit number and 3 × A = 3 + 3 + 3 + 3 + 3. What is A?',
      hint: '右边有几个 3？', hinty: '右边有几多个 3？', hinte: 'How many 3s are on the right?',
      exp: '右边是 5 个 3 相加，就是 3 乘 5，所以 A 是 5。', expe: 'Five 3s added is 3 × 5, so A = 5.',
      howto: '乘法就是同一个数连加：数一数加了几次。', howtoe: 'Multiplication is repeated adding: count how many times.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q9', show: '35 + __ = 42', a: '7', ans: 'num',
      q: '35 加多少等于 42？', qy: '35 加几多等于 42？', qe: '35 + ___ = 42. What fills the blank?',
      hint: '从 35 数到 40 要几步，再到 42 呢？', hinty: '由 35 数到 40 要几步，再到 42 呢？', hinte: 'Count from 35 to 40, then to 42.',
      exp: '35 到 40 是 5，40 到 42 是 2，一共 7。', expe: '35 to 40 is 5, 40 to 42 is 2: 7 in all.',
      howto: '求加数：和减已知数，或者先凑到整十再数。', howtoe: 'Missing addend: subtract, or count up to the next ten first.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2018-Primary-1 Q10', fig: 'timo_fig/p18-q10.png', a: '6', ans: 'num',
      q: '看图：竖式里 B 加上两位数 2B 等于 32，两个 B 是同一个数字。B 是多少？', qy: '睇图：直式入面 B 加两位数 2B 等于 32，两个 B 系同一个数字。B 系几多？',
      qe: 'Look at the column sum: B + 2B = 32, and both B are the same digit. What is B?',
      hint: '个位：B 加 B 的个位是 2。', hinty: '个位：B 加 B 嘅个位系 2。', hinte: 'Units column: B + B ends in 2.',
      exp: 'B 加 B 个位是 2，可能是 1 或 6；试 6：6 加 26 等于 32，对了。', expe: 'B + B ends in 2, so B is 1 or 6. Try 6: 6 + 26 = 32. Correct.',
      howto: '竖式填数从个位开始试，找到可能的数再整条验算。', howtoe: 'Start from the units column, try the possible digits, then check the whole sum.' },
    Object.assign({ lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q11', ans: 'choice',
      q: '在 1、8、5、4 中间填加号或减号，使结果等于 8。哪一条算式对？', qy: '喺 1、8、5、4 中间填加号或者减号，令结果等于 8。边一条算式啱？',
      qe: 'Put + or − between 1, 8, 5, 4 to make 8. Which one is right?',
      hint: '每条都算一算。全部加是 18，要少 10。', hinty: '每条都计下。全部加系 18，要少 10。', hinte: 'All plus gives 18, which is 10 too many.',
      exp: '1 加 8 减 5 加 4：9 减 5 是 4，4 加 4 是 8。', expe: '1 + 8 − 5 + 4: 9 − 5 = 4, 4 + 4 = 8.',
      howto: '全部用加号先算；把某个数前的加号改成减号，总数会少两倍那个数。', howtoe: 'Changing a + to − lowers the total by twice that number.' }, signs([1, 8, 5, 4], 8)),
    Object.assign({ lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q12', ans: 'choice',
      q: '在 1、4、5、7 中间填加号或减号，使结果等于 7。哪一条算式对？', qy: '喺 1、4、5、7 中间填加号或者减号，令结果等于 7。边一条算式啱？',
      qe: 'Put + or − between 1, 4, 5, 7 to make 7. Which one is right?',
      hint: '全部加是 17，要少 10，就是把 5 前面改成减号。', hinty: '全部加系 17，要少 10，即系将 5 前面改做减号。', hinte: 'All plus gives 17; to lose 10, make the 5 negative.',
      exp: '1 加 4 减 5 加 7：5 减 5 是 0，0 加 7 是 7。', expe: '1 + 4 − 5 + 7: 5 − 5 = 0, 0 + 7 = 7.',
      howto: '全部用加号先算；多出来的一半，就是要改成减号的那个数。', howtoe: 'Half of the extra amount is the number that must be subtracted.' }, signs([1, 4, 5, 7], 7)),
    { lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q13', a: '6', ans: 'num',
      q: '四个学生一共有 16 个气球，每人数量都不同。气球最多的那个至少有多少个？', qy: '四个学生一共有 16 个气球，每人数量都唔同。气球最多嗰个最少有几多个？',
      qe: 'Four students have 16 balloons in total, each a different number. At least how many does the student with the most have?',
      hint: '要让最多的尽量少，四个人的数要尽量接近。', hinty: '想最多嗰个尽量少，四个人嘅数要尽量接近。', hinte: 'To keep the biggest small, make the four numbers as close as possible.',
      exp: '如果最多是 5，四人最多 5 加 4 加 3 加 2 等于 14，不够 16；最多是 6 时可以 6、5、4、1，所以至少 6 个。', expe: 'If the most were 5, the total could be at most 5 + 4 + 3 + 2 = 14, not enough. With 6: 6, 5, 4, 1 works. So 6.',
      howto: '问「最多的至少几个」：先假设一个数，看其他人最多能凑到多少，不够就加一。', howtoe: 'Guess the biggest, see the most the others can reach; if short, go up by one.' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q14', show: '2 + 5 + 8 + 11 + 14 + 17 + 20 + 232', a: '单数', ans: 'choice', opts: ['单数', '双数'], optse: ['odd', 'even'],
      q: '2 加 5 加 8 加 11 加 14 加 17 加 20 加 232，结果是单数还是双数？', qy: '2 加 5 加 8 加 11 加 14 加 17 加 20 加 232，结果系单数定双数？',
      qe: 'Is 2 + 5 + 8 + 11 + 14 + 17 + 20 + 232 odd or even?',
      hint: '不用算出来，数一数有几个单数。', hinty: '唔使计出嚟，数下有几多个单数。', hinte: 'No need to add it up: count the odd numbers.',
      exp: '单数有 5、11、17，一共 3 个；单数个数是单数，结果就是单数。', expe: 'There are three odd numbers (5, 11, 17); an odd count of odd numbers gives an odd total.',
      howto: '判断和的单双：只数单数有几个，双数个单数相加是双数，单数个就是单数。', howtoe: 'Only the odd numbers matter: an even count gives even, an odd count gives odd.' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2018-Primary-1 Q15', a: '9', ans: 'num',
      q: '个位是 6 的两位数一共有多少个？', qy: '个位系 6 嘅两位数一共有几多个？', qe: 'How many two-digit numbers have 6 as the units digit?',
      hint: '从 16 开始往上数：16、26……', hinty: '由 16 开始向上数：16、26……', hinte: 'Start at 16: 16, 26, ...',
      exp: '16、26、36、46、56、66、76、86、96，十位可以是 1 到 9，一共 9 个。', expe: '16, 26, ... 96: the tens digit can be 1 to 9, so 9 numbers.',
      howto: '个位固定时，只看十位能填几个数字；十位不能是 0。', howtoe: 'With the units fixed, count the choices for the tens digit (not 0).' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2018-Primary-1 Q16', fig: 'timo_fig/p18-q16.png', a: '8', ans: 'num',
      q: '看图：图中一共有多少个正方形？大的小的都要数。', qy: '睇图：图入面一共有几多个正方形？大嘅细嘅都要数。', qe: 'Look at the picture. How many squares are there, big and small?',
      hint: '先数小格，再找 2 乘 2 拼成的大正方形。', hinty: '先数细格，再搵 2 乘 2 拼成嘅大正方形。', hinte: 'Count the small squares, then look for 2 by 2 squares.',
      exp: '小正方形 7 个；中间上下四格拼成 1 个大正方形，一共 8 个。', expe: '7 small squares plus 1 big square in the middle: 8.',
      howto: '数正方形分大小：最小的、两格乘两格的，逐个检查是否完整。', howtoe: 'Count by size and check each larger square is complete.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2018-Primary-1 Q18', fig: 'timo_fig/p18-q18.png', a: '6', ans: 'num',
      q: '看图：图中一共有多少个三角形？大的小的都要数。', qy: '睇图：图入面一共有几多个三角形？大嘅细嘅都要数。', qe: 'Look at the picture. How many triangles are there, big and small?',
      hint: '先数小三角形，再看左边四个小三角形能不能拼成大三角形。', hinty: '先数细三角形，再睇左边四个细三角形拼唔拼到大三角形。', hinte: 'Count the small ones, then look for a big one made of four.',
      exp: '小三角形 5 个；左下角四个小三角形拼成 1 个大三角形，一共 6 个。', expe: '5 small triangles plus 1 big one made of four: 6.',
      howto: '数三角形分大小：先数最小的，再找几个拼起来的。', howtoe: 'Count the smallest first, then combinations of several.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2018-Primary-1 Q19', show: '△ ○ □ △ ○ □ △ ○ □ △ __ □', a: '圆', ans: 'choice', opts: SHAPE.opts, optse: SHAPE.optse,
      q: '按规律：三角、圆、方，一直重复，三角后面的空格是什么？', qy: '跟规律：三角、圆、方，一路重复，三角后面嘅空格系咩？',
      qe: 'Pattern: triangle, circle, square, repeating. What goes in the blank after the triangle?',
      hint: '三个一组：三角、圆、方。', hinty: '三个一组：三角、圆、方。', hinte: 'It repeats in threes: triangle, circle, square.',
      exp: '三角后面总是圆。', expe: 'A circle always follows a triangle.',
      howto: '图形规律先找重复的一组，再看空格在组里第几个。', howtoe: 'Find the repeating block, then place the blank.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2018-Primary-1 Q20', fig: 'timo_fig/p18-q20.png', a: '91', ans: 'num',
      q: '看图：第 1 组 1 个，第 3 组 6 个，第 5 组 15 个，像楼梯一样每行少一个。第 13 组有多少个？',
      qy: '睇图：第 1 组 1 个，第 3 组 6 个，第 5 组 15 个，好似楼梯咁每行少一个。第 13 组有几多个？',
      qe: 'Look at the picture: group 1 has 1, group 3 has 6, group 5 has 15, like stairs with one fewer each row. How many in group 13?',
      hint: '第 5 组是 5 加 4 加 3 加 2 加 1。', hinty: '第 5 组系 5 加 4 加 3 加 2 加 1。', hinte: 'Group 5 is 5 + 4 + 3 + 2 + 1.',
      exp: '第 13 组是 13 加 12 一直加到 1；头尾配对每对 14，有 6 对半：6 乘 14 加 7 等于 91。', expe: 'Group 13 is 13 + 12 + ... + 1. Pairs of 14: six pairs plus 7 in the middle = 91.',
      howto: '楼梯形的个数是连续数相加：1 加到 n，用头尾配对来算。', howtoe: 'Staircase counts are 1 + 2 + ... + n; pair the ends to add quickly.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q21', a: '5', ans: 'num',
      q: '把 10 分成两个一位数相加，有多少种分法？5 加 6 和 6 加 5 算同一种。', qy: '将 10 分成两个一位数相加，有几多种分法？5 加 6 同 6 加 5 当系同一种。',
      qe: 'Write 10 as the sum of two 1-digit numbers. How many ways are there? 5 + 6 and 6 + 5 count as the same.',
      hint: '从 1 加 9 开始列出来。', hinty: '由 1 加 9 开始列出嚟。', hinte: 'List them, starting with 1 + 9.',
      exp: '1+9、2+8、3+7、4+6、5+5，一共 5 种。', expe: '1+9, 2+8, 3+7, 4+6, 5+5: five ways.',
      howto: '分拆数要有顺序地列：小的那个数从 1 开始往上，到一半为止。', howtoe: 'List in order: let the smaller number go up from 1 until halfway.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q22', a: '51', ans: 'num',
      q: '用 1、3、4、7 四个数字（各用一次）组成两个两位数，再相加，和最小是多少？', qy: '用 1、3、4、7 四个数字（每个用一次）组成两个两位数，再加埋，最细嘅和系几多？',
      qe: 'Use 1, 3, 4 and 7 once each to make two 2-digit numbers and add them. What is the smallest possible sum?',
      hint: '十位的数影响大，十位放最小的两个。', hinty: '十位影响大，十位放最细嗰两个。', hinte: 'Tens digits matter more: put the two smallest there.',
      exp: '十位放 1 和 3，个位放 4 和 7：14 加 37 等于 51。', expe: 'Tens 1 and 3, units 4 and 7: 14 + 37 = 51.',
      howto: '要和最小，小的数字放高位；要和最大，大的数字放高位。', howtoe: 'For the smallest sum, small digits go in the tens place.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q23', show: '15 + 3, 17 − 8, 18 + 9, 12 + 9, 19 − 9', a: '4', ans: 'num',
      q: '15 加 3、17 减 8、18 加 9、12 加 9、19 减 9，这些算式的答案里有多少个两位数？', qy: '15 加 3、17 减 8、18 加 9、12 加 9、19 减 9，呢啲算式嘅答案入面有几多个两位数？',
      qe: 'Work out 15 + 3, 17 − 8, 18 + 9, 12 + 9, 19 − 9. How many answers are 2-digit numbers?',
      hint: '先把每个答案算出来。', hinty: '先计晒每个答案。', hinte: 'Work out every answer first.',
      exp: '答案是 18、9、27、21、10，两位数有 18、27、21、10，一共 4 个。', expe: 'The answers are 18, 9, 27, 21, 10. Four of them have 2 digits.',
      howto: '先全部算出来写好，再一个个判断。', howtoe: 'Write all answers down, then check each one.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q24', a: '19', ans: 'num',
      q: '最大的一位双数和最小的两位单数相加，等于多少？', qy: '最大嘅一位双数同最细嘅两位单数加埋，等于几多？', qe: 'Add the greatest 1-digit even number and the smallest 2-digit odd number.',
      hint: '最大的一位双数是 8；最小的两位单数呢？', hinty: '最大嘅一位双数系 8；最细嘅两位单数呢？', hinte: 'The greatest 1-digit even number is 8. What about the other?',
      exp: '最大的一位双数是 8，最小的两位单数是 11，8 加 11 等于 19。', expe: '8 + 11 = 19.',
      howto: '先把每个条件对应的数找出来，再计算。', howtoe: 'Find each number from its description first, then add.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2018-Primary-1 Q25', a: '6', ans: 'num',
      q: '彼得有 12 个 1 元硬币，可以换多少个 2 元硬币？', qy: '彼得有 12 个一蚊，可以换几多个两蚊？', qe: 'Peter has twelve $1 coins. How many $2 coins can he exchange them for?',
      hint: '两个 1 元换一个 2 元。', hinty: '两个一蚊换一个两蚊。', hinte: 'Two $1 coins make one $2 coin.',
      exp: '12 个两个两个分，分成 6 份，换 6 个 2 元。', expe: '12 in twos makes 6 groups: 6 coins.',
      howto: '换钱就是分组：几个小的凑一个大的。', howtoe: 'Exchanging coins is grouping.' },

    /* ================= TIMO-2020-2021-mock-Primary-1（有答案页，逐题核对） ================= */
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q1', a: '4', ans: 'num',
      q: '玛莉有一个哥哥和三个妹妹，玛莉的哥哥有多少个妹妹？', qy: '玛莉有一个哥哥同三个妹妹，玛莉个哥哥有几多个妹妹？', qe: "Mary has one elder brother and three younger sisters. How many younger sisters does Mary's brother have?",
      hint: '对哥哥来说，玛莉也是妹妹。', hinty: '对哥哥嚟讲，玛莉都系妹妹。', hinte: "To the brother, Mary is a sister too.",
      exp: '三个妹妹加上玛莉自己，哥哥有 4 个妹妹。', expe: 'The three sisters plus Mary: 4.',
      howto: '亲属题换一个人的角度看，别漏了题目里的人。', howtoe: "Look from the other person's point of view; don't leave anyone out." },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q2', a: '猫', ans: 'choice', opts: ['猫', '狗', '兔'], optse: ['cat', 'dog', 'bunny'],
      q: '艾美、宾利和云妮每人有一只宠物：猫、狗或兔。艾美养的不是猫，宾利养的是兔。云妮养的是什么？', qy: '艾美、宾利同云妮每人有一只宠物：猫、狗或者兔。艾美养嘅唔系猫，宾利养兔。云妮养咩？',
      qe: 'Amy, Benny and Winnie each have one pet: a cat, a dog or a bunny. Amy does not have a cat. Benny has a bunny. What does Winnie have?',
      hint: '宾利是兔，艾美不是猫，那艾美是什么？', hinty: '宾利系兔，艾美唔系猫，咁艾美系咩？', hinte: 'Benny has the bunny and Amy has no cat. So what does Amy have?',
      exp: '兔是宾利的；艾美不是猫，只能是狗；剩下的猫是云妮的。', expe: 'Benny has the bunny, Amy must have the dog, so Winnie has the cat.',
      howto: '逻辑配对：先定下确定的，再排除，最后剩下的就是答案。', howtoe: 'Fix what is certain, cross out, and the last one left is the answer.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q3', a: '2', ans: 'num',
      q: '安迪要切一个蛋糕，最少切几刀才能保证分成 4 份？', qy: '安迪要切一个蛋糕，最少切几多刀先确保可以分成 4 份？', qe: 'Andy needs to cut a cake. At least how many cuts does he need to get 4 pieces?',
      hint: '切一个十字看看。', hinty: '切一个十字睇下。', hinte: 'Try cutting a cross.',
      exp: '先横切一刀，再竖切一刀，十字形就是 4 份，所以最少 2 刀。', expe: 'One cut across and one cut down make a cross: 4 pieces with 2 cuts.',
      howto: '切东西题画一画：每一刀尽量穿过之前所有的刀痕。', howtoe: 'Draw it: each new cut should cross all the earlier cuts.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q4', a: '71', ans: 'num',
      q: '约翰写了一个两位数让彼得猜。猜 16 时，约翰说有一个数字对、但位置错了；猜 67 时，也是有一个数字对、位置错了。这个数是多少？',
      qy: '约翰写咗一个两位数畀彼得估。估 16 时，约翰话有一个数字啱、但位置错咗；估 67 时，都系有一个数字啱、位置错咗。呢个数系几多？',
      qe: 'John wrote a 2-digit number. For 16 he said one digit is right but in the wrong place. For 67 he said the same. What is the number?',
      hint: '6 在 16 和 67 里位置不同，试试 6 能不能是对的数字。', hinty: '6 喺 16 同 67 入面位置唔同，试下 6 系咪啱嗰个数字。', hinte: 'Try whether 6 can be the right digit in both guesses.',
      exp: '如果是 6，它在 16 是个位、在 67 是十位，不可能两次都位置错，所以对的是 16 里的 1 和 67 里的 7：1 要在个位，7 要在十位，答案是 71。', expe: 'If 6 were right, it could not be in the wrong place both times. So 1 (from 16) goes to the units and 7 (from 67) to the tens: 71.',
      howto: '猜数题逐个假设：假设某个数字对，看会不会和条件矛盾。', howtoe: 'Assume a digit is right and check it against every clue.' },
    { lv: 'p1', sec: '逻辑', src: 'TIMO-2020-2021-mock-Primary-1 Q5', fig: 'timo_fig/p20-q5.png', a: '10', ans: 'num',
      q: '看图：圆排成三角形，第 1 组 1 个，第 2 组 3 个，第 3 组 6 个。第 4 组有多少个圆？', qy: '睇图：圆排成三角形，第 1 组 1 个，第 2 组 3 个，第 3 组 6 个。第 4 组有几多个圆？',
      qe: 'Look at the picture: circles in triangles, 1, 3, 6. How many circles in group 4?',
      hint: '每组多了一整行，第 4 组底下一行有 4 个。', hinty: '每组多咗一行，第 4 组最底一行有 4 个。', hinte: 'Each group adds a new bottom row; group 4 adds a row of 4.',
      exp: '第 3 组 6 个，再加底下一行 4 个，等于 10 个。', expe: '6 + 4 = 10.',
      howto: '图形规律先看每组比上一组多了多少，再加下去。', howtoe: 'See how much each group adds, then add the next row.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q6', show: '3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3', a: '30', ans: 'num',
      q: '10 个 3 连加，3 加 3 一直加到第 10 个 3，等于多少？', qy: '10 个 3 连加，3 加 3 一路加到第 10 个 3，等于几多？', qe: 'What is 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 (ten 3s)?',
      hint: '5 个 3 是 15，再来 5 个呢？', hinty: '5 个 3 系 15，再嚟 5 个呢？', hinte: 'Five 3s make 15. Then another five?',
      exp: '10 个 3 就是 3 乘 10 等于 30。', expe: 'Ten 3s is 3 × 10 = 30.',
      howto: '同一个数连加很多次，先数个数，用乘法或分两半算。', howtoe: 'For many repeated adds, count them and multiply, or split in halves.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q7', show: '82 + 19 − 42', a: '59', ans: 'num',
      q: '82 加 19 减 42 等于多少？', qy: '82 加 19 减 42 等于几多？', qe: 'What is 82 + 19 − 42?',
      hint: '先算 82 减 42 更容易。', hinty: '先计 82 减 42 会易啲。', hinte: 'It is easier to do 82 − 42 first.',
      exp: '82 减 42 等于 40，40 加 19 等于 59。', expe: '82 − 42 = 40, and 40 + 19 = 59.',
      howto: '加减混合可以换顺序：先算能凑整十的两项。', howtoe: 'You can reorder: do the pair that gives a round number first.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q8', show: '22 + __ = 30', a: '8', ans: 'num',
      q: '22 加多少等于 30？', qy: '22 加几多等于 30？', qe: '22 + ___ = 30. What fills the blank?',
      hint: '从 22 数到 30。', hinty: '由 22 数到 30。', hinte: 'Count up from 22 to 30.',
      exp: '30 减 22 等于 8。', expe: '30 − 22 = 8.',
      howto: '求加数：和减已知数，算完加回去验算。', howtoe: 'Missing addend: subtract, then add back to check.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q9', show: '1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11', a: '66', ans: 'num',
      q: '1 加 2 加 3 一直加到 11，等于多少？', qy: '1 加 2 加 3 一路加到 11，等于几多？', qe: 'What is 1 + 2 + 3 + ... + 11?',
      hint: '1 加 10、2 加 9……这样配对，11 留着。', hinty: '1 加 10、2 加 9……咁样配对，11 留住。', hinte: 'Pair 1 + 10, 2 + 9, ... and keep 11 aside.',
      exp: '1 到 10 配成 5 对，每对 11，是 55；再加 11 等于 66。', expe: '1 to 10 makes 5 pairs of 11 = 55, plus 11 = 66.',
      howto: '一长串连续数相加，用头尾配对，数有几对。', howtoe: 'For a run of numbers, pair the ends and count the pairs.' },
    { lv: 'p1', sec: '算术', src: 'TIMO-2020-2021-mock-Primary-1 Q10', show: '18 − A = B', a: '9', ans: 'num',
      q: 'A 和 B 都是一位数，18 减 A 等于 B，A 是多少？', qy: 'A 同 B 都系一位数，18 减 A 等于 B，A 系几多？', qe: 'A and B are both 1-digit numbers and 18 − A = B. What is A?',
      hint: '一位数最大是 9。', hinty: '一位数最大系 9。', hinte: 'The biggest 1-digit number is 9.',
      exp: 'A 加 B 等于 18，两个一位数加起来最多是 9 加 9 等于 18，所以 A 和 B 都是 9。', expe: 'A + B = 18, and two 1-digit numbers make 18 only as 9 + 9. So A = 9.',
      howto: '有「一位数」的条件时，想想最大最小能到多少。', howtoe: 'With a 1-digit condition, think about the largest and smallest possible.' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q11', a: '3', ans: 'num',
      q: '艾美有 10 个苹果，约翰有 4 个。要让两人一样多，艾美要给约翰多少个？', qy: '艾美有 10 个苹果，约翰有 4 个。要两个人一样多，艾美要畀约翰几多个？',
      qe: 'Amy has 10 apples and John has 4. How many must Amy give John so they have the same?',
      hint: '两人一共几个？一样多的话每人几个？', hinty: '两个人一共几个？一样多嘅话每人几个？', hinte: 'How many altogether? How many each if equal?',
      exp: '一共 14 个，一样多每人 7 个；约翰有 4 个，要再给 3 个。', expe: '14 altogether means 7 each; John has 4, so Amy gives 3.',
      howto: '给到一样多：总数除以 2 是每人应得的，再看少的那个还差几个。', howtoe: 'Half of the total is each share; see what the smaller one is missing.' },
    Object.assign({ lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q12', ans: 'choice',
      q: '在 1、3、5、7 中间填加号或减号，使结果等于 6。哪一条算式对？', qy: '喺 1、3、5、7 中间填加号或者减号，令结果等于 6。边一条算式啱？',
      qe: 'Put + or − between 1, 3, 5, 7 to make 6. Which one is right?',
      hint: '全部加是 16，多了 10，要把哪个数改成减？', hinty: '全部加系 16，多咗 10，要将边个数改做减？', hinte: 'All plus gives 16, 10 too many. Which number should be subtracted?',
      exp: '1 加 3 减 5 加 7：4 减 5 加 7 等于 6。', expe: '1 + 3 − 5 + 7 = 6.',
      howto: '全部用加号先算；多出来的一半，就是要改成减号的那个数。', howtoe: 'Half of the extra amount is the number that must be subtracted.' }, signs([1, 3, 5, 7], 6)),
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q13', a: '5', ans: 'num',
      q: '四个小孩一共有 11 个气球，每人数量都不同，而且每人至少 1 个。气球最多的那个有多少个？', qy: '四个细路一共有 11 个气球，每人数量都唔同，而且每人最少 1 个。气球最多嗰个有几多个？',
      qe: 'Four children have 11 balloons in total, all different numbers and at least one each. How many does the child with the most have?',
      hint: '先让另外三个人尽量少：1、2、3。', hinty: '先畀另外三个人尽量少：1、2、3。', hinte: 'Give the other three as few as possible: 1, 2, 3.',
      exp: '另外三人最少 1 加 2 加 3 等于 6，剩下 11 减 6 等于 5。', expe: 'The others take at least 1 + 2 + 3 = 6, so the last has 11 − 6 = 5.',
      howto: '求最多那个：让其他人尽量少，但每人要不同。', howtoe: 'Give the others as little as possible while keeping them different.' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q14', a: '9', ans: 'num',
      q: '个位是 0 的两位数一共有多少个？', qy: '个位系 0 嘅两位数一共有几多个？', qe: 'How many two-digit numbers have 0 as the units digit?',
      hint: '10、20、30……数到哪里？', hinty: '10、20、30……数到边度？', hinte: '10, 20, 30, ... where does it stop?',
      exp: '10、20、30 一直到 90，一共 9 个。', expe: '10, 20, ... 90: nine numbers.',
      howto: '个位固定时，只看十位能填几个数字；十位不能是 0。', howtoe: 'With the units fixed, count the tens digits (not 0).' },
    { lv: 'p1', sec: '数论', src: 'TIMO-2020-2021-mock-Primary-1 Q15', show: '1, 4, 7, 10, 13, __', a: '16', ans: 'num',
      q: '按规律：1、4、7、10、13，下一个是多少？', qy: '跟规律：1、4、7、10、13，下一个系几多？', qe: 'Pattern: 1, 4, 7, 10, 13. What comes next?',
      hint: '每次加了多少？', hinty: '每次加咗几多？', hinte: 'How much is added each time?',
      exp: '每次加 3，13 加 3 等于 16。', expe: 'Each time add 3: 13 + 3 = 16.',
      howto: '数列先算相邻两个数差多少，再往下推。', howtoe: 'Find the gap between neighbours and carry it on.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q16', fig: 'timo_fig/p20-q16.png', a: '14', ans: 'num',
      q: '看图：3 乘 3 的方格里一共有多少个正方形？大的小的都要数。', qy: '睇图：3 乘 3 嘅方格入面一共有几多个正方形？大嘅细嘅都要数。', qe: 'Look at the 3 by 3 grid. How many squares are there, big and small?',
      hint: '1 格的有几个？2 乘 2 的有几个？3 乘 3 的呢？', hinty: '1 格嘅有几多个？2 乘 2 嘅有几多个？3 乘 3 嘅呢？', hinte: 'How many 1 by 1? 2 by 2? 3 by 3?',
      exp: '1 格的 9 个，2 乘 2 的 4 个，3 乘 3 的 1 个，一共 14 个。', expe: '9 small, 4 two-by-two, 1 three-by-three: 14.',
      howto: '方格数正方形：按大小分开数再相加。', howtoe: 'Count squares size by size, then add.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q17', fig: 'timo_fig/p20-q17.png', a: '6', ans: 'num',
      q: '看图：这堆立方体一共有多少个？', qy: '睇图：呢堆立方体一共有几多个？', qe: 'Look at the picture. How many cubes are there?',
      hint: '分上下两层数，上面那个下面一定有一个托着。', hinty: '分上下两层数，上面嗰个下面一定有一个托住。', hinte: 'Count each layer; the top cube must sit on one below.',
      exp: '底层前排 3 个、后排 2 个，上层 1 个，一共 6 个。', expe: 'Bottom layer: 3 in front and 2 behind; 1 on top: 6.',
      howto: '数立方体一层一层数，看不见的要想一想有没有托着。', howtoe: 'Count layer by layer and think about hidden supporting cubes.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q18', fig: 'timo_fig/p20-q18.png', a: '13', ans: 'num',
      q: '看图：图中一共有多少个三角形？大的小的都要数。', qy: '睇图：图入面一共有几多个三角形？大嘅细嘅都要数。', qe: 'Look at the picture. How many triangles are there, big and small?',
      hint: '先数最小的 9 个，再数 4 个拼成的中三角形，最后整个大的。', hinty: '先数最细嘅 9 个，再数 4 个拼成嘅中三角形，最后成个大嘅。', hinte: 'Count the 9 smallest, then the medium ones made of 4, then the whole.',
      exp: '最小的 9 个，中等的 3 个，整个大三角形 1 个，一共 13 个。', expe: '9 small + 3 medium + 1 big = 13.',
      howto: '数三角形分大小一层层数，尖朝上和尖朝下的都要看。', howtoe: 'Count size by size, both pointing up and pointing down.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q19', fig: 'timo_fig/p20-q19.png', a: 'E', ans: 'choice', opts: ['A', 'B', 'C', 'D', 'E'],
      q: '看图：五个图形里，哪一个和其他的不一样？', qy: '睇图：五个图形入面，边一个同其他唔一样？', qe: 'Look at the picture. Which figure is not like the others?',
      hint: '试试把每个图形对折，能不能两边完全重合。', hinty: '试下将每个图形对折，两边可唔可以完全重合。', hinte: 'Try folding each shape in half. Do the halves match?',
      exp: 'A、B、C、D 都能对折重合（对称），E 这个斜的平行四边形怎么折都不能重合。', expe: 'A to D can be folded so the halves match; the slanted shape E cannot.',
      howto: '找不同：逐个检查同一个特点，比如能不能对折、有没有直角。', howtoe: 'Check one property at a time, like folding symmetry or right angles.' },
    { lv: 'p1', sec: '几何', src: 'TIMO-2020-2021-mock-Primary-1 Q20', show: '○ □ △ ○ ○ □ △ ○ __ □ △ ○ ○ □ △', a: '圆', ans: 'choice', opts: SHAPE.opts, optse: SHAPE.optse,
      q: '按规律：圆、方、三角、圆，一直重复。第 9 个空格是什么？', qy: '跟规律：圆、方、三角、圆，一路重复。第 9 个空格系咩？',
      qe: 'Pattern: circle, square, triangle, circle, repeating. What is in the 9th place, the blank?',
      hint: '四个一组：圆、方、三角、圆。', hinty: '四个一组：圆、方、三角、圆。', hinte: 'It repeats in fours: circle, square, triangle, circle.',
      exp: '每组 4 个，第 9 个是第三组的第 1 个，是圆。', expe: 'Blocks of 4; the 9th is the first of the third block: a circle.',
      howto: '先找一组有几个，再数空格是组里第几个。', howtoe: 'Find the block length, then where the blank falls in it.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q21', a: '4', ans: 'num',
      q: '把 8 粒糖果分成一样多的两份，每份多少粒？', qy: '将 8 粒糖分成一样多嘅两份，每份几多粒？', qe: 'Split 8 candies into two equal groups. How many in each?',
      hint: '8 的一半是多少？', hinty: '8 嘅一半系几多？', hinte: 'What is half of 8?',
      exp: '8 的一半是 4。', expe: 'Half of 8 is 4.',
      howto: '平均分成两份就是找一半。', howtoe: 'Two equal groups means half.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q22', a: '9', ans: 'num',
      q: '从 1、3、5、8 里选 2 个不同的数字组成两位数，能组成多少个单数？', qy: '由 1、3、5、8 入面拣 2 个唔同嘅数字组成两位数，可以组成几多个单数？',
      qe: 'Pick 2 different digits from 1, 3, 5, 8 to make a two-digit number. How many odd numbers can you make?',
      hint: '单数的个位要是 1、3 或 5。', hinty: '单数嘅个位要系 1、3 或者 5。', hinte: 'An odd number must end in 1, 3 or 5.',
      exp: '个位有 1、3、5 三种，每种十位还剩 3 个数字可选，3 乘 3 等于 9 个。', expe: '3 choices for the units, then 3 for the tens: 3 × 3 = 9.',
      howto: '组数先定决定条件的那一位（单双看个位），再数另一位能填几个。', howtoe: 'Fix the digit that decides the condition first, then count the other.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q23', a: '6', ans: 'num',
      q: '从学校到车站有 3 条路，从车站到图书馆有 2 条路。从学校经车站到图书馆，有几种走法？', qy: '由学校去车站有 3 条路，由车站去图书馆有 2 条路。由学校经车站去图书馆，有几多种行法？',
      qe: 'There are 3 ways from school to the station and 2 from the station to the library. How many ways from school to the library through the station?',
      hint: '第一段每一条路，后面都有 2 种选法。', hinty: '第一段每一条路，后面都有 2 种拣法。', hinte: 'Each first road has 2 choices after it.',
      exp: '3 条路各配 2 条路，3 乘 2 等于 6 种。', expe: '3 × 2 = 6 ways.',
      howto: '分两步走：第一步的方法数乘第二步的方法数。', howtoe: 'Two steps: multiply the choices for each step.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q24', a: '1368', ans: 'num',
      q: '用 3、6、1、8 各用一次，组成最小的四位数是多少？', qy: '用 3、6、1、8 每个用一次，组成最细嘅四位数系几多？', qe: 'Use 3, 6, 1 and 8 once each. What is the smallest 4-digit number?',
      hint: '最小的数字放最前面。', hinty: '最细嘅数字放最前面。', hinte: 'Put the smallest digit first.',
      exp: '从小到大排：1、3、6、8，就是 1368。', expe: 'Smallest to largest: 1368.',
      howto: '组最小的数从小到大排，0 不能放最前面。', howtoe: 'Smallest number: digits small to big, never starting with 0.' },
    { lv: 'p1', sec: '组合', src: 'TIMO-2020-2021-mock-Primary-1 Q25', a: '7', ans: 'num',
      q: '从 0、3、5、6、9 里选 2 个不同的数字组成两位数，能组成多少个 5 的倍数？', qy: '由 0、3、5、6、9 入面拣 2 个唔同嘅数字组成两位数，可以组成几多个 5 嘅倍数？',
      qe: 'Pick 2 different digits from 0, 3, 5, 6, 9 to make a two-digit number. How many multiples of 5 can you make?',
      hint: '5 的倍数个位是 0 或 5；十位不能是 0。', hinty: '5 嘅倍数个位系 0 或者 5；十位唔可以系 0。', hinte: 'Multiples of 5 end in 0 or 5; the tens digit cannot be 0.',
      exp: '个位是 0：30、50、60、90，4 个；个位是 5：35、65、95，3 个。一共 7 个。', expe: 'Ending in 0: 30, 50, 60, 90; ending in 5: 35, 65, 95. Total 7.',
      howto: '分情况数：个位是 0 一种情况，个位是 5 一种情况，分别数再相加。', howtoe: 'Split into cases (ends in 0, ends in 5), count each, then add.' },
  ];

  /* ===== 反背题：动态出题模板 =====
   * 数字由 rng 现场生成、答案当场算出来：孩子记住「上次答案是 13」没有用。
   * pick() 每轮最多放 ORIG_PER_ROUND 道原卷题（10 天内出过的不再出），其余用生成题，
   * 生成题避开最近 SEEN_MAX 道出过的题面。复练走 variant()：错题换同型新数据，不是原题重来。
   */
  const RND = (lo, hi, rng) => lo + Math.floor((rng || Math.random)() * (hi - lo + 1));
  /* 题目指纹：题面 + 选项（排序后）。选择题题面相同、选项不同算不同题；原卷题打乱选项后仍是同一题 */
  const fp = q => [q && q.qe, ((q && q.opts) || []).slice().sort().join(','), q && q.fig, q && q.show, q && q.svg]
    .map(x => String(x || '')).join('|').replace(/\s+/g, ' ').trim().toLowerCase();
  const SEEN_KEY = 'timo_seen_v1', SEEN_MAX = 300;
  const ORIG_KEY = 'timo_orig_seen_v1', ORIG_COOL_MS = 10 * 86400e3, ORIG_PER_ROUND = 3;
  function loadSeen() { try { const a = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveSeen(list) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(-SEEN_MAX))); } catch (e) {} }
  function noteSeen(list) { if (list.length) saveSeen(loadSeen().concat(list)); }
  function loadOrig() { try { const m = JSON.parse(localStorage.getItem(ORIG_KEY) || '{}'); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch (e) { return {}; } }
  function noteOrig(list) {
    if (!list.length) return;
    const m = loadOrig(), now = Date.now();
    list.forEach(f => { m[f] = now; });
    try { localStorage.setItem(ORIG_KEY, JSON.stringify(m)); } catch (e) {}
  }
  const origFresh = (m, q) => !(m[fp(q)] > Date.now() - ORIG_COOL_MS);
  function shuffled(a, rng) { const r = rng || Math.random; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  /* 选择题正确项随机摆位：不能靠「每次都点第二个」蒙对 */
  function withCorrect(correct, others, rng) {
    const opts = others.slice(), at = Math.floor((rng || Math.random)() * (opts.length + 1));
    opts.splice(at, 0, correct);
    return opts;
  }
  const SEQ = (n, f, sep) => Array.from({ length: n }, (_, i) => f(i)).join(sep);
  const pickOne = (arr, r) => arr[RND(0, arr.length - 1, r)];

  /* ---- 生成题的图（SVG 字符串，页面直接嵌） ---- */
  function gridSvg(rows, cols) {
    const s = 44, w = cols * s + 4, h = rows * s + 4;
    let p = '';
    for (let i = 0; i <= rows; i++) p += `M2 ${2 + i * s}H${2 + cols * s}`;
    for (let j = 0; j <= cols; j++) p += `M${2 + j * s} 2V${2 + rows * s}`;
    return `<svg viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}"><path d="${p}" fill="none" stroke="#222" stroke-width="2"/></svg>`;
  }
  function fanSvg(k) {
    const W = 220, H = 170, ax = W / 2, ay = 6, y = H - 4;
    let p = `M${ax} ${ay}L4 ${y}L${W - 4} ${y}Z`;
    for (let i = 1; i <= k; i++) p += `M${ax} ${ay}L${4 + (W - 8) * i / (k + 1)} ${y}`;
    return `<svg viewBox="0 0 ${W} ${H}" width="${W * 1.6}" height="${H * 1.6}"><path d="${p}" fill="none" stroke="#222" stroke-width="2"/></svg>`;
  }
  const squaresIn = (r, c) => { let n = 0; for (let k = 1; k <= Math.min(r, c); k++) n += (r - k + 1) * (c - k + 1); return n; };

  /* 填加减号：随机数 + 随机符号，只留答案唯一的；选项是整条算式 */
  function signsGen(lv, cnt, lo, hi, r) {
    for (let t = 0; t < 40; t++) {
      const nums = Array.from({ length: cnt }, () => RND(lo, hi, r));
      const ops = Array.from({ length: cnt - 1 }, () => r() < 0.5);
      let v = nums[0]; ops.forEach((p, i) => { v += p ? nums[i + 1] : -nums[i + 1]; });
      if (v < 0) continue;
      let s; try { s = signs(nums, v); } catch (e) { continue; }
      const L = nums.join('、');
      return Object.assign({ lv, sec: '数论', src: 'gen:填加减号', ans: 'choice', opts: shuffled(s.opts.slice(), r),
        q: `在 ${L} 中间填加号或减号，使结果等于 ${v}。哪一条算式对？`, qy: `喺 ${L} 中间填加号或者减号，令结果等于 ${v}。边一条算式啱？`,
        qe: `Put + or − between ${nums.join(', ')} to make ${v}. Which one is right?`,
        hint: '每条算式都从左到右算一遍。', hinty: '每条算式都由左到右计一次。', hinte: 'Work out each one from left to right.',
        exp: `${s.a} = ${v}。`, expe: `${s.a} = ${v}.`,
        howto: '全部用加号先算；多出来的一半，就是要改成减号的那个数。', howtoe: 'Try all plus first; half of the extra is the number to subtract.' }, { a: s.a, show: s.show });
    }
    return null;
  }

  const GEN = [
    /* ---------- K2 / 幼稚园组 ---------- */
    { id: 'k2-add3', lv: 'k2', sec: '算术', make(r) {
        const a = RND(2, 19, r), b = RND(2, 19, r), c = RND(2, 9, r), s1 = a + b, s = s1 + c;
        return { lv: 'k2', sec: '算术', src: 'gen:连加', ans: 'num', a: String(s), show: `${a} + ${b} + ${c}`,
          q: `${a} 加 ${b} 加 ${c} 等于多少？`, qy: `${a} 加 ${b} 加 ${c} 等于几多？`, qe: `What is ${a} + ${b} + ${c}?`,
          hint: `先算 ${a} 加 ${b}。`, hinty: `先计 ${a} 加 ${b}。`, hinte: `Start with ${a} + ${b}.`,
          exp: `${a} + ${b} = ${s1}，再 ${s1} + ${c} = ${s}。`, expe: `${a} + ${b} = ${s1}, then ${s1} + ${c} = ${s}.`,
          howto: '连加从左往右一步一步算，每步写下中间结果。', howtoe: 'Work left to right and write each step down.' };
      } },
    { id: 'k2-sub2', lv: 'k2', sec: '算术', make(r) {
        const a = RND(12, 20, r), b = RND(2, 8, r), room = a - b;
        const c = RND(2, Math.max(2, Math.min(9, room - 1)), r), s1 = a - b, s = s1 - c;
        return { lv: 'k2', sec: '算术', src: 'gen:连减', ans: 'num', a: String(s), show: `${a} − ${b} − ${c}`,
          q: `${a} 减 ${b} 再减 ${c} 等于多少？`, qy: `${a} 减 ${b} 再减 ${c} 等于几多？`, qe: `What is ${a} − ${b} − ${c}?`,
          hint: `先算 ${a} 减 ${b}。`, hinty: `先计 ${a} 减 ${b}。`, hinte: `Start with ${a} − ${b}.`,
          exp: `${a} − ${b} = ${s1}，再 ${s1} − ${c} = ${s}。`, expe: `${a} − ${b} = ${s1}, then ${s1} − ${c} = ${s}.`,
          howto: '连减先算第一步，把得到的数再减第二个；可以用加法验算。', howtoe: 'Subtract step by step and check by adding back.' };
      } },
    { id: 'k2-seq', lv: 'k2', sec: '逻辑', make(r) {
        const d = RND(2, 6, r), down = r() < 0.4, st = down ? RND(4 * d + 1, 4 * d + 12, r) : RND(1, 9, r);
        const term = i => down ? st - i * d : st + i * d, a = term(4);
        return { lv: 'k2', sec: '逻辑', src: 'gen:规律', ans: 'num', a: String(a), show: SEQ(4, term, ', ') + ', __',
          q: `按规律：${SEQ(4, term, '、')}，下一个是多少？`, qy: `跟规律：${SEQ(4, term, '、')}，下一个系几多？`,
          qe: `Pattern: ${SEQ(4, term, ', ')}. What comes next?`,
          hint: down ? '看看每次少了多少。' : '看看每次加了多少。', hinty: down ? '睇下每次少咗几多。' : '睇下每次加咗几多。', hinte: down ? 'How much smaller each time?' : 'How much is added each time?',
          exp: `每次${down ? '减' : '加'} ${d}，${term(3)} ${down ? '−' : '+'} ${d} = ${a}。`, expe: `Each step ${down ? 'subtracts' : 'adds'} ${d}: ${term(3)} ${down ? '−' : '+'} ${d} = ${a}.`,
          howto: '规律题先算相邻两个数差多少，差固定就用这个差往下推。', howtoe: 'Find the gap between neighbours; if it is constant, carry it on.' };
      } },
    { id: 'k2-times', lv: 'k2', sec: '算术', make(r) {
        const m = RND(2, 5, r), n = RND(2, 9, r), a = m * n;
        return { lv: 'k2', sec: '算术', src: 'gen:几个几', ans: 'num', a: String(a), show: Array(m).fill(n).join(' + '),
          q: `${m} 个 ${n} 加起来是多少？`, qy: `${m} 个 ${n} 加埋系几多？`, qe: `What is ${n} added ${m} times?`,
          hint: `一个一个加：${n}、${n + n}……`, hinty: `一个一个加：${n}、${n + n}……`, hinte: `Add them one at a time: ${n}, ${n + n}, ...`,
          exp: `${Array(m).fill(n).join(' + ')} = ${a}。`, expe: `${Array(m).fill(n).join(' + ')} = ${a}.`,
          howto: '同一个数连加，跳着数，数清加了几次。', howtoe: 'Skip-count and keep track of how many times.' };
      } },
    { id: 'k2-share2', lv: 'k2', sec: '组合', make(r) {
        const m = RND(2, 5, r), k = RND(2, 8, r), total = m * k;
        const who = pickOne(['小朋友', '盒子', '袋子', '盘子'], r);
        const whEn = { '小朋友': 'children', '盒子': 'boxes', '袋子': 'bags', '盘子': 'plates' }[who];
        const it = pickOne([['苹果', '苹果', 'apples'], ['糖', '糖', 'sweets'], ['饼干', '饼', 'biscuits']], r);
        return { lv: 'k2', sec: '组合', src: 'gen:平均分', ans: 'num', a: String(k),
          q: `${total} 个${it[0]}平均分给 ${m} 个${who}，每个${who}几个？`, qy: `${total} 个${it[1]}平均分畀 ${m} 个${who}，每个${who}几多个？`,
          qe: `${total} ${it[2]} are shared equally among ${m} ${whEn}. How many does each get?`,
          hint: `${m} 个几相加会等于 ${total}？`, hinty: `${m} 个几加埋会等于 ${total}？`, hinte: `${m} lots of what make ${total}?`,
          exp: `${Array(m).fill(k).join(' + ')} = ${total}，每个 ${k} 个。`, expe: `${Array(m).fill(k).join(' + ')} = ${total}, so ${k} each.`,
          howto: '平均分可以一轮一轮发，或者想几个几相加等于总数。', howtoe: 'Hand out one round at a time, or think which repeated add makes the total.' };
      } },
    { id: 'k2-blank', lv: 'k2', sec: '算术', make(r) {
        const sum = RND(12, 40, r), a = RND(5, sum - 2, r), ans = sum - a;
        return { lv: 'k2', sec: '算术', src: 'gen:填空', ans: 'num', a: String(ans), show: `${a} + __ = ${sum}`,
          q: `${a} 加多少等于 ${sum}？`, qy: `${a} 加几多等于 ${sum}？`, qe: `${a} + ___ = ${sum}. What fills the blank?`,
          hint: `从 ${a} 往上数到 ${sum}。`, hinty: `由 ${a} 向上数到 ${sum}。`, hinte: `Count up from ${a} to ${sum}.`,
          exp: `${sum} − ${a} = ${ans}。`, expe: `${sum} − ${a} = ${ans}.`,
          howto: '求加数用减法：和减已知的数；算完加回去验一下。', howtoe: 'Missing addend: total minus the known part, then add back to check.' };
      } },
    { id: 'k2-more', lv: 'k2', sec: '数论', make(r) {
        const y = RND(2, 20, r), x = RND(y + 1, y + 15, r), ans = x - y;
        const nm = pickOne([['小明', '小红', 'Ming', 'Ling'], ['积及', '艾美', 'Jacob', 'Amy'], ['彼得', '玛莉', 'Peter', 'Mary']], r);
        return { lv: 'k2', sec: '数论', src: 'gen:相差', ans: 'num', a: String(ans),
          q: `${nm[0]}有 ${x} 粒糖，${nm[1]}有 ${y} 粒。${nm[0]}比${nm[1]}多多少粒？`, qy: `${nm[0]}有 ${x} 粒糖，${nm[1]}有 ${y} 粒。${nm[0]}多${nm[1]}几多粒？`,
          qe: `${nm[2]} has ${x} sweets and ${nm[3]} has ${y}. How many more does ${nm[2]} have?`,
          hint: '比多少用减法。', hinty: '比几多用减法。', hinte: 'Compare with subtraction.',
          exp: `${x} − ${y} = ${ans}。`, expe: `${x} − ${y} = ${ans}.`,
          howto: '「多多少」就是大数减小数，不是把两个数加起来。', howtoe: 'How many more means bigger minus smaller.' };
      } },
    { id: 'k2-compare', lv: 'k2', sec: '数论', make(r) {
        const nums = shuffled([RND(1, 20, r), RND(21, 40, r), RND(41, 60, r), RND(61, 99, r)], r).slice(0, 3).map(String);
        const big = r() < 0.5, sorted = nums.slice().sort((x, y) => Number(x) - Number(y)), a = big ? sorted[2] : sorted[0];
        return { lv: 'k2', sec: '数论', src: 'gen:比大小', ans: 'choice', opts: nums, a,
          q: `${nums.join('、')}，哪一个最${big ? '大' : '小'}？`, qy: `${nums.join('、')}，边一个最${big ? '大' : '细'}？`,
          qe: `Which is the ${big ? 'biggest' : 'smallest'}: ${nums.join(', ')}?`,
          hint: '先看十位，十位一样再看个位。', hinty: '先睇十位，十位一样再睇个位。', hinte: 'Check the tens digit first.',
          exp: `从小到大是 ${sorted.join('、')}，最${big ? '大' : '小'}的是 ${a}。`, expe: `In order: ${sorted.join(', ')}. The ${big ? 'biggest' : 'smallest'} is ${a}.`,
          howto: '比大小先比位数，位数一样从高位往下比。', howtoe: 'Compare digit by digit from the left.' };
      } },
    { id: 'k2-shapes', lv: 'k2', sec: '逻辑', make(r) {
        const SH = [['圆', '○', 'circle'], ['方', '□', 'square'], ['三角', '△', 'triangle'], ['星', '☆', 'star']];
        const pool = shuffled(SH.slice(), r), kind = RND(0, 2, r);
        const block = kind === 0 ? [pool[0], pool[1]] : kind === 1 ? [pool[0], pool[1], pool[2]] : [pool[0], pool[0], pool[1]];
        const len = block.length * 3, seq = Array.from({ length: len }, (_, i) => block[i % block.length]);
        const at = RND(block.length, len - 1, r), a = seq[at];
        const show = seq.map((s, i) => i === at ? '__' : s[1]).join(' ');
        const zh = seq.map((s, i) => i === at ? '空格' : s[0]).join('、'), en = seq.map((s, i) => i === at ? 'blank' : s[2]).join(', ');
        const used = shuffled(Array.from(new Set(block.concat([pool[2]]))), r);
        return { lv: 'k2', sec: '逻辑', src: 'gen:图形规律', ans: 'choice', show,
          opts: used.map(s => s[0]), optse: used.map(s => s[2]), a: a[0],
          q: `按规律：${zh}。空格是什么？`, qy: `跟规律：${zh}。空格系咩？`, qe: `Pattern: ${en}. What is the blank?`,
          hint: `${block.length} 个一组重复。`, hinty: `${block.length} 个一组重复。`, hinte: `It repeats in groups of ${block.length}.`,
          exp: `一组是 ${block.map(s => s[0]).join('、')}，空格是第 ${at + 1} 个，所以是${a[0]}。`, expe: `The block is ${block.map(s => s[2]).join(', ')}; place ${at + 1} is a ${a[2]}.`,
          howto: '图形规律先找重复的一组，再看空格在组里第几个。', howtoe: 'Find the repeating block, then see where the blank falls.' };
      } },
    { id: 'k2-parity', lv: 'k2', sec: '数论', make(r) {
        const n = RND(11, 99, r), odd = n % 2 === 1;
        return { lv: 'k2', sec: '数论', src: 'gen:单双数', ans: 'choice', opts: ['单数', '双数'], optse: ['odd', 'even'], a: odd ? '单数' : '双数',
          q: `${n} 是单数还是双数？`, qy: `${n} 系单数定双数？`, qe: `Is ${n} odd or even?`,
          hint: '看个位：1、3、5、7、9 是单数。', hinty: '睇个位：1、3、5、7、9 系单数。', hinte: 'Look at the units digit: 1, 3, 5, 7, 9 mean odd.',
          exp: `${n} 的个位是 ${n % 10}，所以是${odd ? '单数' : '双数'}。`, expe: `The units digit of ${n} is ${n % 10}, so it is ${odd ? 'odd' : 'even'}.`,
          howto: '判断单双只看个位。', howtoe: 'Odd or even is decided by the units digit alone.' };
      } },
    { id: 'k2-half', lv: 'k2', sec: '算术', make(r) {
        const k = RND(2, 15, r), total = k * 2, it = pickOne([['颗星', '粒星', 'stars'], ['个苹果', '个苹果', 'apples'], ['粒糖', '粒糖', 'sweets'], ['支笔', '支笔', 'pencils']], r);
        return { lv: 'k2', sec: '算术', src: 'gen:一半', ans: 'num', a: String(k),
          q: `把 ${total} ${it[0]}分成一样多的两份，每份多少？`, qy: `将 ${total} ${it[1]}分成一样多嘅两份，每份几多？`, qe: `Split ${total} ${it[2]} into two equal groups. How many in each?`,
          hint: `想：几加几等于 ${total}，两个数一样？`, hinty: `谂下：几加几等于 ${total}，两个数一样？`, hinte: `Which number added to itself makes ${total}?`,
          exp: `${k} + ${k} = ${total}，每份 ${k}。`, expe: `${k} + ${k} = ${total}, so ${k} each.`,
          howto: '一半就是平均分两份：哪个数加自己等于总数。', howtoe: 'Half means two equal parts: which number doubled makes the total?' };
      } },
    { id: 'k2-signs', lv: 'k2', sec: '数论', make(r) { return signsGen('k2', 3, 1, 9, r); } },
    { id: 'k2-grid', lv: 'k2', sec: '几何', make(r) {
        const rows = RND(1, 2, r), cols = RND(2, rows === 1 ? 5 : 3, r), a = squaresIn(rows, cols);
        return { lv: 'k2', sec: '几何', src: 'gen:数正方形', ans: 'num', a: String(a), svg: gridSvg(rows, cols),
          q: `看图：${rows} 行 ${cols} 列的方格，一共有多少个正方形？大的小的都要数。`, qy: `睇图：${rows} 行 ${cols} 列嘅方格，一共有几多个正方形？大嘅细嘅都要数。`,
          qe: `Look at the ${rows} by ${cols} grid. How many squares are there, big and small?`,
          hint: rows === 1 ? '一行的话，只有小格子是正方形。' : '先数小格，再找 2 乘 2 的大正方形。', hinty: rows === 1 ? '一行嘅话，淨系细格系正方形。' : '先数细格，再搵 2 乘 2 嘅大正方形。',
          hinte: rows === 1 ? 'In a single row only the small cells are squares.' : 'Count the small cells, then the 2 by 2 squares.',
          exp: rows === 1 ? `只有 ${cols} 个小正方形。` : `小正方形 ${rows * cols} 个，2 乘 2 的 ${a - rows * cols} 个，一共 ${a} 个。`,
          expe: rows === 1 ? `Only the ${cols} small squares.` : `${rows * cols} small and ${a - rows * cols} two-by-two: ${a}.`,
          howto: '数正方形按大小分开数，再加起来；长条拼起来不是正方形。', howtoe: 'Count by size; a long strip is not a square.' };
      } },
    { id: 'k2-fan', lv: 'k2', sec: '几何', make(r) {
        const k = RND(1, 2, r), a = (k + 1) * (k + 2) / 2;
        return { lv: 'k2', sec: '几何', src: 'gen:数三角形', ans: 'num', a: String(a), svg: fanSvg(k),
          q: `看图：大三角形里从顶点画了 ${k} 条线到底边。一共有多少个三角形？大的小的都要数。`, qy: `睇图：大三角形入面由顶点画咗 ${k} 条线落底边。一共有几多个三角形？大嘅细嘅都要数。`,
          qe: `Look at the picture: ${k} line(s) go from the top corner to the bottom. How many triangles are there, big and small?`,
          hint: '先数最小的，再数两个拼起来的，最后整个大的。', hinty: '先数最细嘅，再数两个拼埋嘅，最后成个大嘅。', hinte: 'Count the smallest, then pairs, then the whole one.',
          exp: `底边被分成 ${k + 1} 段，每选两个点就是一个三角形：一共 ${a} 个。`, expe: `The base has ${k + 2} points; every two of them make a triangle: ${a}.`,
          howto: '从顶点出发的线：数底边上任选两段相连的组合。', howtoe: 'Lines from the top: count every run of neighbouring pieces on the base.' };
      } },
    { id: 'k2-family', lv: 'k2', sec: '逻辑', make(r) {
        const b = RND(0, 4, r), s = RND(1, 4, r), a = b + s + 1;
        const nm = pickOne([['积及', 'Jacob'], ['彼得', 'Peter'], ['约翰', 'John']], r);
        return { lv: 'k2', sec: '逻辑', src: 'gen:家里几个孩子', ans: 'num', a: String(a),
          q: `${nm[0]}有 ${b} 个兄弟和 ${s} 个姐妹。${nm[0]}家一共有多少个孩子？`, qy: `${nm[0]}有 ${b} 个兄弟同 ${s} 个姊妹。${nm[0]}屋企一共有几多个细路？`,
          qe: `${nm[1]} has ${b} brother(s) and ${s} sister(s). How many children are in the family?`,
          hint: `别忘了算${nm[0]}自己。`, hinty: `唔好漏咗${nm[0]}自己。`, hinte: `Remember to count ${nm[1]} too.`,
          exp: `${b} 加 ${s} 再加${nm[0]}自己，等于 ${a}。`, expe: `${b} + ${s} + 1 = ${a}.`,
          howto: '数一家的孩子，要把题目里的人自己也算上。', howtoe: 'Include the person in the question.' };
      } },
    { id: 'k2-coins', lv: 'k2', sec: '组合', make(r) {
        const ones = RND(1, 5, r), fives = RND(0, 3, r), tens = RND(0, 2, r), a = ones + 5 * fives + 10 * tens;
        if (!fives && !tens) return null;
        const parts = [`${ones} 个 1 元`].concat(fives ? [`${fives} 个 5 元`] : []).concat(tens ? [`${tens} 个 10 元`] : []);
        const pe = [`${ones} $1 coin(s)`].concat(fives ? [`${fives} $5 coin(s)`] : []).concat(tens ? [`${tens} $10 coin(s)`] : []);
        return { lv: 'k2', sec: '组合', src: 'gen:数钱', ans: 'num', a: String(a),
          q: `彼得有 ${parts.join('、')}，一共有多少元？`, qy: `彼得有 ${parts.join('、').replace(/元/g, '蚊')}，一共有几多蚊？`,
          qe: `Peter has ${pe.join(', ')}. How much money is that?`,
          hint: '同一种硬币先合起来。', hinty: '同一种硬币先合埋。', hinte: 'Add up each kind of coin first.',
          exp: `${ones}${fives ? ` + ${5 * fives}` : ''}${tens ? ` + ${10 * tens}` : ''} = ${a} 元。`, expe: `${ones}${fives ? ` + ${5 * fives}` : ''}${tens ? ` + ${10 * tens}` : ''} = $${a}.`,
          howto: '数钱：同一种硬币先合起来，再把几种加在一起。', howtoe: 'Group the same coins first, then add the groups.' };
      } },

    { id: 'k2-polygon', lv: 'k2', sec: '几何', make(r) {
        const n = RND(3, 9, r), sides = r() < 0.5, rot = RND(0, 3, r) * Math.PI / (2 * n);
        const R = 80, c = 90, pts = Array.from({ length: n }, (_, i) => {
          const t = -Math.PI / 2 + rot + i * 2 * Math.PI / n; return `${(c + R * Math.cos(t)).toFixed(1)},${(c + R * Math.sin(t)).toFixed(1)}`; });
        const svg = `<svg viewBox="0 0 180 180" width="300" height="300"><polygon points="${pts.join(' ')}" fill="#eef3f8" stroke="#222" stroke-width="3"/></svg>`;
        return { lv: 'k2', sec: '几何', src: 'gen:数边数角', ans: 'num', a: String(n), svg,
          q: `看图：这个图形有多少${sides ? '条边' : '只角'}？`, qy: `睇图：呢个图形有几多${sides ? '条边' : '只角'}？`,
          qe: `Look at the shape. How many ${sides ? 'sides' : 'corners'} does it have?`,
          hint: '先在一处做记号，用手指沿着走一圈。', hinty: '先喺一处做记号，用手指沿住行一圈。', hinte: 'Mark a starting point and trace round once.',
          exp: `这个图形有 ${n} 条边、${n} 只角。`, expe: `It has ${n} sides and ${n} corners.`,
          howto: '多边形的边数和角数一样多，数一样可以验另一样。', howtoe: 'A polygon has as many corners as sides, so one checks the other.' };
      } },
    /* ---------- P1 / 小一 ---------- */
    { id: 'p1-give', lv: 'p1', sec: '数论', make(r) {
        const b = RND(0, 15, r), d = RND(1, 9, r), a = b + 2 * d;
        const it = pickOne([['个苹果', 'apples'], ['个梨', 'pears'], ['张贴纸', 'stickers'], ['粒波子', 'marbles']], r);
        return { lv: 'p1', sec: '数论', src: 'gen:给到一样多', ans: 'num', a: String(d),
          q: `艾美有 ${a} ${it[0]}，约翰有 ${b} ${it[0]}。要让两人一样多，艾美要给约翰多少？`, qy: `艾美有 ${a} ${it[0]}，约翰有 ${b} ${it[0]}。要两个人一样多，艾美要畀约翰几多？`,
          qe: `Amy has ${a} ${it[1]} and John has ${b}. How many must Amy give John so they are equal?`,
          hint: `一共 ${a + b}，一样多每人几个？`, hinty: `一共 ${a + b}，一样多每人几个？`, hinte: `There are ${a + b} in total. How many each if equal?`,
          exp: `一共 ${a + b}，每人应得 ${(a + b) / 2}；约翰有 ${b}，所以给 ${d}。`, expe: `${a + b} in total means ${(a + b) / 2} each. John has ${b}, so Amy gives ${d}.`,
          howto: '给到一样多：先算总数、每人应得多少，再看少的那个差几个。', howtoe: 'Total, then each share, then what the smaller one is missing.' };
      } },
    { id: 'p1-balloons', lv: 'p1', sec: '数论', make(r) {
        const kids = RND(3, 4, r), low = kids === 3 ? 3 : 6, total = RND(low + 4, low + 16, r), ans = total - low;
        const lows = kids === 3 ? '1、2' : '1、2、3';
        return { lv: 'p1', sec: '数论', src: 'gen:最多最少', ans: 'num', a: String(ans),
          q: `${kids} 个小孩一共有 ${total} 个气球，每人数量都不同，每人至少 1 个。气球最多的那个最多能有多少个？`, qy: `${kids} 个细路一共有 ${total} 个气球，每人数量都唔同，每人最少 1 个。气球最多嗰个最多可以有几多个？`,
          qe: `${kids} children have ${total} balloons, all different numbers, at least one each. At most how many can the child with the most have?`,
          hint: `先给其他人尽量少：${lows}。`, hinty: `先畀其他人尽量少：${lows}。`, hinte: `Give the others as few as possible: ${lows.replace(/、/g, ', ')}.`,
          exp: `其他人最少一共 ${low}，剩下 ${total} − ${low} = ${ans}。`, expe: `The others take at least ${low}, leaving ${total} − ${low} = ${ans}.`,
          howto: '求某人最多：让其他人尽量少，但每人要不同。', howtoe: 'Give the others as little as possible while keeping them different.' };
      } },
    { id: 'p1-odd', lv: 'p1', sec: '组合', make(r) {
        const ds = shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], r).slice(0, 4).sort((x, y) => x - y);
        const odd = r() < 0.6;
        let ans = 0;
        for (const t of ds) for (const u of ds) if (t !== u && t !== 0 && (u % 2 === 1) === odd) ans++;
        return { lv: 'p1', sec: '组合', src: 'gen:单双数个数', ans: 'num', a: String(ans),
          q: `从 ${ds.join('、')} 里选 2 个不同的数字组成两位数，能组成多少个${odd ? '单数' : '双数'}？`, qy: `由 ${ds.join('、')} 入面拣 2 个唔同嘅数字组成两位数，可以组成几多个${odd ? '单数' : '双数'}？`,
          qe: `Pick 2 different digits from ${ds.join(', ')} to make two-digit numbers. How many are ${odd ? 'odd' : 'even'}?`,
          hint: `先看个位能放哪些${odd ? '单' : '双'}数字，十位不能是 0。`, hinty: `先睇个位可以放边啲${odd ? '单' : '双'}数字，十位唔可以系 0。`, hinte: `Which ${odd ? 'odd' : 'even'} digits can go last? The first digit cannot be 0.`,
          exp: `按个位逐个数，十位要和个位不同、不能是 0，一共 ${ans} 个。`, expe: `Go through each possible units digit; the tens digit must differ and not be 0. Total ${ans}.`,
          howto: '分位置想：个位决定单双，十位不能是 0、不能重复；按个位分情况数再相加。', howtoe: 'The units digit decides odd/even; the tens digit cannot be 0 or repeat. Count case by case.' };
      } },
    { id: 'p1-pairsum', lv: 'p1', sec: '算术', make(r) {
        const s = RND(1, 6, r), n = RND(s + 6, s + 12, r), cnt = n - s + 1, ans = (s + n) * cnt / 2;
        return { lv: 'p1', sec: '算术', src: 'gen:连加配对', ans: 'num', a: String(ans), show: `${s} + ${s + 1} + ${s + 2} + … + ${n}`,
          q: `${s} 加 ${s + 1} 一直加到 ${n}，等于多少？`, qy: `${s} 加 ${s + 1} 一路加到 ${n}，等于几多？`, qe: `What is ${s} + ${s + 1} + ... + ${n}?`,
          hint: `${s} 配 ${n}、${s + 1} 配 ${n - 1}……每对一样大。`, hinty: `${s} 配 ${n}、${s + 1} 配 ${n - 1}……每对一样大。`, hinte: `Pair ${s} with ${n}, ${s + 1} with ${n - 1}... each pair is the same.`,
          exp: `一共 ${cnt} 个数，每对和是 ${s + n}${cnt % 2 ? `，中间剩一个 ${(s + n) / 2}` : ''}，总和 ${ans}。`, expe: `${cnt} numbers, each pair makes ${s + n}${cnt % 2 ? `, with ${(s + n) / 2} left in the middle` : ''}: ${ans}.`,
          howto: '连续数相加：头尾配对，每对和一样，再数有几对。', howtoe: 'Pair the ends; every pair has the same sum; count the pairs.' };
      } },
    { id: 'p1-digits', lv: 'p1', sec: '组合', make(r) {
        const ds = shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], r).slice(0, 4), big = r() < 0.5;
        const sorted = ds.slice().sort((x, y) => big ? y - x : x - y);
        if (!big && sorted[0] === 0) { const i = sorted.findIndex(v => v > 0); sorted.unshift(sorted.splice(i, 1)[0]); }
        const ans = sorted.join('');
        return { lv: 'p1', sec: '组合', src: big ? 'gen:最大四位数' : 'gen:最小四位数', ans: 'num', a: ans,
          q: `用 ${ds.join('、')} 各用一次，组成最${big ? '大' : '小'}的四位数是多少？`, qy: `用 ${ds.join('、')} 每个用一次，组成最${big ? '大' : '细'}嘅四位数系几多？`,
          qe: `Use ${ds.join(', ')} once each to make the ${big ? 'largest' : 'smallest'} 4-digit number.`,
          hint: big ? '最大的数字放千位。' : '最小的数字放千位，但 0 不能放最前。', hinty: big ? '最大嘅数字放千位。' : '最细嘅数字放千位，但 0 唔可以放最前。', hinte: big ? 'Put the largest digit first.' : 'Put the smallest digit first, but never 0.',
          exp: `按${big ? '从大到小' : '从小到大'}排${!big && ds.indexOf(0) >= 0 ? '，0 放第二位' : ''}：${ans}。`, expe: `Order the digits ${big ? 'largest to smallest' : 'smallest to largest'}${!big && ds.indexOf(0) >= 0 ? ', with 0 in second place' : ''}: ${ans}.`,
          howto: '组最大数从大到小排，组最小数从小到大排，0 不能放最高位。', howtoe: 'Largest: big to small. Smallest: small to big, with 0 never first.' };
      } },
    { id: 'p1-seqmul', lv: 'p1', sec: '逻辑', make(r) {
        const k = RND(2, 3, r), terms = k === 2 ? 4 : 3, st = k === 2 ? RND(1, 9, r) : RND(1, 3, r);
        const t = i => st * Math.pow(k, i), a = t(terms);
        return { lv: 'p1', sec: '逻辑', src: 'gen:倍数规律', ans: 'num', a: String(a), show: SEQ(terms, t, ', ') + ', __',
          q: `按规律：${SEQ(terms, t, '、')}，下一个是多少？`, qy: `跟规律：${SEQ(terms, t, '、')}，下一个系几多？`, qe: `Pattern: ${SEQ(terms, t, ', ')}. What comes next?`,
          hint: '看看每个数是前一个的几倍。', hinty: '睇下每个数系前一个嘅几倍。', hinte: 'How many times bigger is each term?',
          exp: `每次都乘 ${k}，${t(terms - 1)} 乘 ${k} 等于 ${a}。`, expe: `Each term is multiplied by ${k}: ${t(terms - 1)} × ${k} = ${a}.`,
          howto: '数列的差越来越大时，试试看是不是每次乘同一个数。', howtoe: 'If the gaps keep growing, check whether each term is multiplied by the same number.' };
      } },
    { id: 'p1-route', lv: 'p1', sec: '组合', make(r) {
        const legs = r() < 0.6 ? 2 : 3, ns = Array.from({ length: legs }, () => RND(2, legs === 2 ? 6 : 3, r)), a = ns.reduce((x, y) => x * y, 1);
        const pl = ['学校', '车站', '公园', '图书馆'].slice(0, legs + 1), ple = ['school', 'the station', 'the park', 'the library'].slice(0, legs + 1);
        const segs = ns.map((n, i) => `从${pl[i]}到${pl[i + 1]}有 ${n} 条路`).join('，');
        const segsy = ns.map((n, i) => `由${pl[i]}去${pl[i + 1]}有 ${n} 条路`).join('，');
        const segse = ns.map((n, i) => `${n} ways from ${ple[i]} to ${ple[i + 1]}`).join(', ');
        return { lv: 'p1', sec: '组合', src: 'gen:走法', ans: 'num', a: String(a),
          q: `${segs}。从${pl[0]}一路走到${pl[legs]}，有几种走法？`, qy: `${segsy}。由${pl[0]}一路行到${pl[legs]}，有几多种行法？`,
          qe: `There are ${segse}. How many ways from ${ple[0]} all the way to ${ple[legs]}?`,
          hint: '每一段的每条路，都可以接下一段的任何一条。', hinty: '每一段嘅每条路，都可以接下一段任何一条。', hinte: 'Every road on one leg can join any road on the next.',
          exp: `${ns.join(' × ')} = ${a} 种。`, expe: `${ns.join(' × ')} = ${a} ways.`,
          howto: '分几步走，每一步的方法数相乘。', howtoe: 'Multiply the number of choices for each step.' };
      } },
    { id: 'p1-mult5', lv: 'p1', sec: '数论', make(r) {
        const good = String(5 * RND(3, 19, r)), others = [];
        while (others.length < 3) { const v = RND(11, 99, r); if (v % 5 && String(v) !== good && others.indexOf(String(v)) < 0) others.push(String(v)); }
        const opts = withCorrect(good, others, r);
        return { lv: 'p1', sec: '数论', src: 'gen:5 的倍数', ans: 'choice', opts, a: good,
          q: `${opts.join('、')}，哪一个是 5 的倍数？`, qy: `${opts.join('、')}，边一个系 5 嘅倍数？`, qe: `Which is a multiple of 5: ${opts.join(', ')}?`,
          hint: '5 的倍数个位一定是 0 或 5。', hinty: '5 嘅倍数个位一定系 0 或者 5。', hinte: 'A multiple of 5 always ends in 0 or 5.',
          exp: `${good} 的个位是 ${good.slice(-1)}，所以是 5 的倍数。`, expe: `${good} ends in ${good.slice(-1)}, so it is a multiple of 5.`,
          howto: '5 的倍数只看个位：个位是 0 或 5。', howtoe: 'Multiples of 5 end in 0 or 5; check the units digit only.' };
      } },
    { id: 'p1-signs', lv: 'p1', sec: '数论', make(r) { return signsGen('p1', 4, 1, 9, r); } },
    { id: 'p1-grid', lv: 'p1', sec: '几何', make(r) {
        const rows = RND(2, 3, r), cols = RND(rows, 4, r), a = squaresIn(rows, cols);
        return { lv: 'p1', sec: '几何', src: 'gen:数正方形', ans: 'num', a: String(a), svg: gridSvg(rows, cols),
          q: `看图：${rows} 行 ${cols} 列的方格，一共有多少个正方形？大的小的都要数。`, qy: `睇图：${rows} 行 ${cols} 列嘅方格，一共有几多个正方形？大嘅细嘅都要数。`,
          qe: `Look at the ${rows} by ${cols} grid. How many squares are there, big and small?`,
          hint: '1 格的、2 乘 2 的、3 乘 3 的分开数。', hinty: '1 格嘅、2 乘 2 嘅、3 乘 3 嘅分开数。', hinte: 'Count 1 by 1, 2 by 2 and 3 by 3 separately.',
          exp: `按大小数：${Array.from({ length: Math.min(rows, cols) }, (_, k) => `${k + 1} 乘 ${k + 1} 的 ${(rows - k) * (cols - k)} 个`).join('，')}，一共 ${a} 个。`,
          expe: `By size: ${Array.from({ length: Math.min(rows, cols) }, (_, k) => `${(rows - k) * (cols - k)} of ${k + 1}x${k + 1}`).join(', ')}. Total ${a}.`,
          howto: '方格数正方形：每种大小数一次再相加；大小为 k 的个数是（行数−k+1）乘（列数−k+1）。', howtoe: 'For each size k, there are (rows−k+1) × (cols−k+1) squares; add them up.' };
      } },
    { id: 'p1-fan', lv: 'p1', sec: '几何', make(r) {
        const k = RND(2, 4, r), a = (k + 1) * (k + 2) / 2;
        return { lv: 'p1', sec: '几何', src: 'gen:数三角形', ans: 'num', a: String(a), svg: fanSvg(k),
          q: `看图：大三角形里从顶点画了 ${k} 条线到底边。一共有多少个三角形？大的小的都要数。`, qy: `睇图：大三角形入面由顶点画咗 ${k} 条线落底边。一共有几多个三角形？大嘅细嘅都要数。`,
          qe: `Look at the picture: ${k} lines go from the top corner to the bottom. How many triangles are there, big and small?`,
          hint: `底边被分成 ${k + 1} 段：数 1 段的、2 段连起来的……`, hinty: `底边分咗 ${k + 1} 段：数 1 段嘅、2 段连埋嘅……`, hinte: `The base is cut into ${k + 1} pieces: count runs of 1, 2, ... pieces.`,
          exp: `${SEQ(k + 1, i => k + 1 - i, ' + ')} = ${a}。`, expe: `${SEQ(k + 1, i => k + 1 - i, ' + ')} = ${a}.`,
          howto: '从一点画出的线：底边分成 n 段，三角形个数是 n 加 n−1 一直加到 1。', howtoe: 'With n pieces on the base, the count is n + (n−1) + ... + 1.' };
      } },
    { id: 'p1-segments', lv: 'p1', sec: '几何', make(r) {
        const k = RND(3, 6, r), a = k * (k - 1) / 2, W = 60 * (k - 1) + 20;
        const dots = Array.from({ length: k }, (_, i) => `<circle cx="${10 + 60 * i}" cy="20" r="6" fill="#222"/>`).join('');
        const svg = `<svg viewBox="0 0 ${W} 40" width="${W * 1.6}" height="64"><path d="M10 20H${W - 10}" stroke="#222" stroke-width="3"/>${dots}</svg>`;
        return { lv: 'p1', sec: '几何', src: 'gen:数线段', ans: 'num', a: String(a), svg,
          q: `看图：一条直线上有 ${k} 个点，一共有多少条线段？（任意两个点之间就是一条）`, qy: `睇图：一条直线上有 ${k} 粒点，一共有几多条线段？（任何两粒点之间就系一条）`,
          qe: `Look at the picture: ${k} points on a line. How many segments are there between any two points?`,
          hint: '从最左边的点出发，能连到几个点？再从第二个点出发……', hinty: '由最左边嗰粒点出发，可以连去几多粒？再由第二粒出发……', hinte: 'From the first point, how many can you reach? Then from the second...',
          exp: `${SEQ(k - 1, i => k - 1 - i, ' + ')} = ${a} 条。`, expe: `${SEQ(k - 1, i => k - 1 - i, ' + ')} = ${a}.`,
          howto: '数线段：从左边的点一个个出发，只往右连，不重复。', howtoe: 'Start from each point in turn and only join to the right.' };
      } },
    { id: 'p1-strip', lv: 'p1', sec: '几何', make(r) {
        const n = RND(2, 6, r), a = n * (n + 1) / 2;
        return { lv: 'p1', sec: '几何', src: 'gen:数长方形', ans: 'num', a: String(a), svg: gridSvg(1, n),
          q: `看图：一排 ${n} 个格子，一共有多少个长方形？（正方形也算长方形，几格连起来的也算）`, qy: `睇图：一排 ${n} 个格，一共有几多个长方形？（正方形都算，几格连埋嘅都算）`,
          qe: `Look at the row of ${n} cells. How many rectangles are there, counting joined cells and squares too?`,
          hint: '1 格的有几个？2 格连起来的有几个？', hinty: '1 格嘅有几多个？2 格连埋嘅有几多个？', hinte: 'How many of 1 cell? Of 2 joined cells?',
          exp: `${SEQ(n, i => n - i, ' + ')} = ${a} 个。`, expe: `${SEQ(n, i => n - i, ' + ')} = ${a}.`,
          howto: '一排格子数长方形：按长度分，1 格、2 格……每种数一次再相加。', howtoe: 'Count by length: 1 cell, 2 cells, ... then add.' };
      } },
    { id: 'p1-age', lv: 'p1', sec: '逻辑', make(r) {
        const ago = RND(2, 6, r), then = RND(5, 14, r), later = RND(2, 6, r), now = then + ago, a = now + later;
        const nm = pickOne([['艾美', 'Amy'], ['玛莉', 'Mary'], ['彼得', 'Peter']], r);
        return { lv: 'p1', sec: '逻辑', src: 'gen:年龄', ans: 'num', a: String(a),
          q: `${ago} 年前${nm[0]} ${then} 岁，${later} 年后${nm[0]}几岁？`, qy: `${ago} 年前${nm[0]} ${then} 岁，${later} 年后${nm[0]}几多岁？`,
          qe: `${ago} years ago, ${nm[1]} was ${then}. How old will ${nm[1]} be in ${later} years?`,
          hint: `先算${nm[0]}现在几岁。`, hinty: `先计${nm[0]}而家几岁。`, hinte: `Work out how old ${nm[1]} is now.`,
          exp: `现在 ${then} + ${ago} = ${now} 岁，${later} 年后 ${now} + ${later} = ${a} 岁。`, expe: `Now ${then} + ${ago} = ${now}; in ${later} years ${a}.`,
          howto: '年龄题先换算到「现在」，再往前或往后算。', howtoe: 'Get to "now" first, then move forward or back.' };
      } },
    { id: 'p1-split', lv: 'p1', sec: '组合', make(r) {
        const n = RND(6, 17, r);
        let a = 0; const ways = [];
        for (let x = 1; x <= 9; x++) { const y = n - x; if (y >= x && y <= 9) { a++; ways.push(`${x}+${y}`); } }
        return { lv: 'p1', sec: '组合', src: 'gen:分拆', ans: 'num', a: String(a),
          q: `把 ${n} 分成两个一位数相加（不用 0），有多少种分法？调换顺序算同一种。`, qy: `将 ${n} 分成两个一位数相加（唔用 0），有几多种分法？调转次序当同一种。`,
          qe: `Write ${n} as the sum of two 1-digit numbers (no 0). How many ways? Swapping the order counts as the same.`,
          hint: '从小的那个数开始，一个一个列。', hinty: '由细嗰个数开始，一个一个列。', hinte: 'List them, starting from the smaller number.',
          exp: `${ways.join('、')}，一共 ${a} 种。`, expe: `${ways.join(', ')}: ${a} ways.`,
          howto: '分拆要有顺序地列：小的数从小到大，直到一半；两个数都要是一位数。', howtoe: 'List in order up to halfway; both numbers must be single digits.' };
      } },
  ];

  /* 分档（页面上的按钮顺序） */
  const LEVELS = [
    { id: 'k2', name: '幼稚园 K2', note: '幼儿园组：原卷题 + 现场生成题，每轮换数据',
      name_en: 'Kindergarten (K2)', note_en: 'TIMO Kindergarten: real past-paper questions plus fresh generated ones' },
    { id: 'p1', name: '小一 P1', note: '一年级：原卷题 + 现场生成题，每轮换数据',
      name_en: 'Primary 1 (P1)', note_en: 'TIMO Primary 1: real past-paper questions plus fresh generated ones' },
  ];

  /* 一道生成题：模板 make() 偶尔返回 null（条件不满足），重试几次 */
  function makeFrom(g, r, avoid) {
    for (let i = 0; i < 8; i++) {
      const q = g.make(r);
      if (q && !avoid(q)) { q._tpl = g.id; return q; }
    }
    return null;
  }

  /* 按档位出题（反背题 + 题型要匀）：
     ① 原卷题每轮最多 ORIG_PER_ROUND 道，10 天内出过的不出，按题型轮转
     ② 其余用生成题：每次挑本轮用得最少的题型，题面避开最近 SEEN_MAX 道
     ③ 实在凑不够才回用原卷题（最久没出的优先）
     ④ 同一题型不超过一轮的一半 */
  function pick(lv, n, rng) {
    const r = rng || Math.random;
    const count = Math.max(1, n || 8);
    const seen = loadSeen(), orig = loadOrig();
    const gens = GEN.filter(g => g.lv === lv);
    const out = [], secUsed = {};
    const inOut = q => out.some(o => fp(o) === fp(q));
    const use = q => { out.push(q); secUsed[q.sec] = (secUsed[q.sec] || 0) + 1; };
    // ①
    const fresh = shuffled(BANK.filter(q => q.lv === lv && origFresh(orig, q)), r);
    const bySec = {};
    for (const q of fresh) (bySec[q.sec] = bySec[q.sec] || []).push(q);
    const secs = shuffled(Object.keys(bySec), r);
    const origCap = Math.min(ORIG_PER_ROUND, count);
    for (let i = 0; out.length < origCap && i < secs.length * 3; i++) {
      const q = (bySec[secs[i % secs.length]] || []).shift();
      if (q && !inOut(q)) use(shuffleOpts(q, r));
    }
    // ②
    const dead = {};   // 这一轮出不了新题的模板（数据组合都见过了），别卡在同一题型上
    for (let guard = 0; out.length < count && guard < 200; guard++) {
      const live = gens.filter(g => !dead[g.id]);
      if (!live.length) break;
      const least = Math.min.apply(null, live.map(g => secUsed[g.sec] || 0));
      const cands = live.filter(g => (secUsed[g.sec] || 0) === least);
      const g = cands[Math.floor(r() * cands.length)];
      const q = makeFrom(g, r, x => seen.indexOf(fp(x)) >= 0 || inOut(x));
      if (q) use(q); else dead[g.id] = 1;
    }
    // ③
    if (out.length < count) {
      const old = BANK.filter(q => q.lv === lv && !inOut(q)).sort((x, y) => (orig[fp(x)] || 0) - (orig[fp(y)] || 0));
      for (const q of old) { if (out.length >= count) break; use(shuffleOpts(q, r)); }
    }
    // ④
    const cap = Math.max(2, Math.ceil(count / 2));
    for (const s of Object.keys(secUsed)) {
      const mine = out.filter(q => q.sec === s);
      while (mine.length > cap) {
        const extra = mine.pop(), at = out.indexOf(extra);
        const g = shuffled(gens.filter(x => x.sec !== s), r)[0];
        const alt = g && makeFrom(g, r, x => inOut(x));
        if (alt && at >= 0) out[at] = alt; else break;
      }
    }
    noteSeen(out.filter(q => q._tpl).map(fp));
    noteOrig(out.filter(q => !q._tpl).map(fp));
    return shuffled(out, r);
  }
  /* 选择题：选项顺序每次打乱（opts/optse 一起），不能靠「上次是第二个」记位置 */
  function shuffleOpts(q, rng) {
    if (!q || !Array.isArray(q.opts) || q.opts.length < 2) return Object.assign({}, q);
    const idx = shuffled(q.opts.map((_, i) => i), rng);
    const c = Object.assign({}, q, { opts: idx.map(i => q.opts[i]) });
    if (Array.isArray(q.optse) && q.optse.length === q.opts.length) c.optse = idx.map(i => q.optse[i]);
    return c;
  }
  /* 复练：错题/跳过的题换一道新题——生成题按同模板换数据；原卷题换同档同题型没出过的原卷题，
     没有就用同题型的生成题。原题刚讲过答案，再做一次只是背 */
  function variant(q, rng) {
    const r = rng || Math.random;
    if (!q) return null;
    const g = q._tpl && GEN.filter(x => x.id === q._tpl)[0];
    if (g) return makeFrom(g, r, x => fp(x) === fp(q));
    const orig = loadOrig();
    const same = shuffled(BANK.filter(b => b.lv === q.lv && b.sec === q.sec && fp(b) !== fp(q) && origFresh(orig, b)), r)[0];
    if (same) { noteOrig([fp(same)]); return shuffleOpts(same, r); }
    const gens = GEN.filter(x => x.lv === q.lv && x.sec === q.sec);
    const pool = gens.length ? gens : GEN.filter(x => x.lv === q.lv);
    const seen = loadSeen();
    for (let i = 0; i < 6 && pool.length; i++) {
      const nq = makeFrom(pool[Math.floor(r() * pool.length)], r, x => seen.indexOf(fp(x)) >= 0);
      if (nq) return nq;
    }
    return null;
  }

  const api = { BANK, GEN, LEVELS, pick, variant, fp, signs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.TIMO = api;
})();
