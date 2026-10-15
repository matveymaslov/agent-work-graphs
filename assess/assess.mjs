#!/usr/bin/env node
// assess.mjs — a 3-minute self-check of your AI agent work graph.
// 20 yes/no questions → a maturity level (0–5) and the list of places where work can pass silently.
// Zero dependencies, Node 18+. Nothing is sent anywhere.
//
//   node assess/assess.mjs                 interactive, English
//   node assess/assess.mjs --lang ru       interactive, Russian
//   node assess/assess.mjs --answers yynyyyyynnyyyynyyyyy   non-interactive (20 letters y/n, in question order)
//   node assess/assess.mjs --print         print the questions only
//
// License: MIT.

import { createInterface } from 'node:readline'
import { stdin, stdout, argv, exit } from 'node:process'

const Q = [
  // [block, en question, ru question, en fix, ru fix]
  ['contract', 'Is "done" written down before the work starts — as a list of checkable items?',
    'Записано ли до начала работы, что значит «готово», — списком проверяемых пунктов?',
    'Write the contract first: every acceptance item with the command that checks it.',
    'Сначала договор: каждый пункт приёмки — с командой, которая его проверяет.'],
  ['contract', 'Is "done" set by someone other than the agent who did the work?',
    'Ставит ли «готово» кто-то, кроме того агента, который делал?',
    'The doer never sets "done": an independent check against the contract does.',
    'Исполнитель не ставит «готово» сам: это делает независимая проверка по договору.'],
  ['contract', 'Does the human see the contract, the evidence and the risks in one place at acceptance?',
    'Видит ли человек на приёмке договор, доказательства и риски в одном месте?',
    'Build one acceptance view: contract + receipts + risks + what was not checked.',
    'Один экран приёмки: договор + квитанции + риски + что не проверено.'],
  ['contract', 'Can every piece of evidence be re-run with one command?',
    'Можно ли перепрогнать каждое доказательство одной командой?',
    'Evidence is a receipt: the command and its result, re-runnable by anyone.',
    'Доказательство — это квитанция: команда и её результат, которые любой может повторить.'],
  ['isolation', 'Does every attempt work in its own copy, from a known state?',
    'Работает ли каждая попытка в своей копии, от известного состояния?',
    'One working copy and one branch per attempt, cut from a recorded commit.',
    'Своя рабочая копия и своя ветка на каждую попытку, от записанного коммита.'],
  ['isolation', 'Are the base and the list of changes in the log — including failed attempts?',
    'Записаны ли в журнал база и список изменений — включая неудачные попытки?',
    'Log the base commit and changed files for every attempt, especially the failed ones.',
    'Пишите в журнал базу и изменённые файлы каждой попытки, особенно неудачной.'],
  ['isolation', 'Can any piece of work be rolled back in one action?',
    'Можно ли откатить любую работу одним действием?',
    'If a rollback needs archaeology, the work is not delivered.',
    'Если откат требует археологии — работа не сдана.'],
  ['isolation', 'Is the agent\'s process UNABLE to read the key that accepts work?',
    'Процесс агента НЕ может прочитать ключ, которым принимается работа?',
    'Run agents as a separate OS user with no access to acceptance keys — or one day work accepts itself.',
    'Запускайте агентов отдельным пользователем без доступа к ключам приёмки — иначе работа однажды примет себя сама.'],
  ['isolation', 'Is the agent UNABLE to write anything a human or the system will later execute (hooks, configs, scripts)?',
    'Агент НЕ может записать то, что потом исполнит человек или система (хуки, конфиги, скрипты)?',
    'Isolation is not "a separate user" — it is a user who cannot write what others run.',
    'Изоляция — это не «отдельный пользователь», а пользователь, который не может писать то, что исполняют другие.'],
  ['signals', 'Does the screen show what is in the event log, rather than a status field?',
    'Показывает ли экран то, что записано в журнале событий, а не поле «статус»?',
    'Derive every status from the log; a status field drifts from reality.',
    'Выводите каждый статус из журнала; поле «статус» расходится с реальностью.'],
  ['signals', 'Have you checked that your checks can go red — that they catch something deliberately broken?',
    'Проверяли ли вы, что ваши проверки умеют краснеть — ловят намеренно сломанное?',
    'Break it on purpose and watch the check fail. A check that cannot fail is decoration.',
    'Сломайте нарочно и убедитесь, что проверка падает. Проверка, которая не может упасть, — декорация.'],
  ['signals', 'Is there a test that proves the connection between parts, not each part alone?',
    'Есть ли тест, который доказывает связь между частями, а не каждую часть отдельно?',
    'For every wire, a test that the value reaches whoever uses it, plus an end-to-end run.',
    'На каждый провод — тест, что значение доезжает до того, кто им пользуется, и сквозной прогон.'],
  ['signals', 'Are your test doubles checked against recordings of what the real thing does?',
    'Сверены ли ваши тестовые двойники с записями того, что делает настоящее?',
    'A double richer than the real library hides a broken product behind green tests.',
    'Двойник богаче настоящей библиотеки прячет сломанный продукт за зелёными тестами.'],
  ['signals', 'Does the system tell "the agent asked a question" apart from "the agent delivered"?',
    'Отличает ли система «агент задал вопрос» от «агент сдал работу»?',
    'A question is a state of the work waiting for an answer, not a message and not a delivery.',
    'Вопрос — это состояние работы, ждущее ответа, а не сообщение и не сдача.'],
  ['signals', 'Does the system say "not measured" for unmeasured spend, instead of counting zero?',
    'Говорит ли система «не измерено» про неизмеренный расход, вместо того чтобы считать ноль?',
    'Unknown is not zero. Name it, then decide by a rule.',
    'Неизвестное — не ноль. Назовите его и решайте по правилу.'],
  ['control', 'Do pause, stop and correction work at task, batch and phase level — and survive a restart?',
    'Работают ли пауза, стоп и поправка на уровне задачи, сборки и фазы — и переживают ли перезапуск?',
    'Three buttons at every level; each one survives a restart of the system.',
    'Три кнопки на каждом уровне; каждая переживает перезапуск системы.'],
  ['control', 'Does the system wake you when work stalls?',
    'Будит ли вас система, когда работа встала?',
    'Every long job gets an alarm at launch; a refusal is a loud signal, never silence.',
    'Каждая долгая работа получает будильник при запуске; отказ — громкий сигнал, а не тишина.'],
  ['control', 'Is an agent UNABLE to postpone a finding "for later" without your word?',
    'Агент НЕ может отложить находку «на потом» без вашего слова?',
    'Fix findings now, with a test; a deferral without the owner\'s word keeps the checks red.',
    'Находка чинится сразу и с тестом; отсрочка без слова владельца держит проверки красными.'],
  ['control', 'Does every failure found become a check that prevents it from happening again?',
    'Превращается ли каждая найденная поломка в проверку, которая не даст её повторить?',
    'A lesson is a mechanism (test, hook, gate), not a note.',
    'Урок — это механизм (тест, хук, ворота), а не заметка.'],
  ['control', 'Has the whole path — request to acceptance — been walked live several times in a row without a slip?',
    'Прошёл ли весь путь — от постановки до приёмки — живьём несколько раз подряд без срыва?',
    'Nothing unrun is handed over. "Pages open" and "gates green" are not "it works".',
    'Непрогнанное не отдаётся. «Страница открылась» и «ворота зелёные» — это не «работает».'],
]

const LEVELS = {
  en: ['0 · Chat — the agent does, you read everything',
    '1 · Statuses — the illusion of control (the most dangerous level)',
    '2 · Gates — errors get caught, but dead wires and fakes slip through',
    '3 · Evidence — you can leave it for the night',
    '4 · Three scales — task, batch and phase each hold on their own',
    '5 · Self-learning — failures become mechanisms by themselves'],
  ru: ['0 · Чат — агент делает, вы читаете всё',
    '1 · Статусы — иллюзия контроля (самый опасный уровень)',
    '2 · Ворота — ошибки ловятся, но мёртвые провода и подделки проходят',
    '3 · Доказательства — можно уходить на ночь',
    '4 · Три масштаба — задача, сборка и фаза держатся сами',
    '5 · Самообучение — поломки сами становятся механизмами'],
}
// A level counts only when every question it rests on is a «yes» (1-based question numbers).
// Level 1 has no requirement beyond «something is tracked» (at least one yes).
const NEEDS = [
  [],
  [],
  [2, 3],
  [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 20],
  Q.map((_, i) => i + 1),
]

const T = {
  en: { title: 'Work graph self-check — 20 questions (y/n)', ask: '[y/n] ', score: 'Score', level: 'Level',
    holes: 'Where work can pass silently, and what to do:', none: 'No holes. Now prove it live, several times in a row.',
    verdictLow: 'Fewer than ten "yes": a list of statuses, not a graph.',
    verdictMid: 'A graph exists, but it does not hold the work without you yet.',
    verdictHigh: 'A real graph. Keep turning every failure into a mechanism.',
    read: 'Why each item matters: README.md, section 3 and 4.' },
  ru: { title: 'Самопроверка графа работы — 20 вопросов (y/n)', ask: '[y/n] ', score: 'Счёт', level: 'Уровень',
    holes: 'Где работа может пройти молча и что сделать:', none: 'Дыр нет. Теперь докажите это живьём, несколько раз подряд.',
    verdictLow: 'Меньше десяти «да»: это список статусов, а не граф.',
    verdictMid: 'Граф есть, но он ещё не держит работу без вас.',
    verdictHigh: 'Настоящий граф. Продолжайте превращать каждую поломку в механизм.',
    read: 'Почему каждый пункт важен: README.ru.md, разделы 3 и 4.' },
}

const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] ?? '') : null }
const lang = arg('--lang') === 'ru' ? 'ru' : 'en'
const t = T[lang]
const text = (q) => (lang === 'ru' ? q[2] : q[1])
const fix = (q) => (lang === 'ru' ? q[4] : q[3])

if (argv.includes('--print')) {
  console.log(t.title + '\n')
  Q.forEach((q, i) => console.log(`${String(i + 1).padStart(2)}. ${text(q)}`))
  exit(0)
}

let answers = []
const given = arg('--answers')
if (given !== null) {
  const clean = given.toLowerCase().replace(/[^yn]/g, '')
  if (clean.length !== Q.length) { console.error(`--answers needs ${Q.length} letters y/n, got ${clean.length}`); exit(2) }
  answers = [...clean].map((c) => c === 'y')
} else {
  // Lines are read through one iterator, so answers piped in ahead of the prompts are not lost.
  const rl = createInterface({ input: stdin, terminal: false })
  const lines = rl[Symbol.asyncIterator]()
  console.log(t.title + '\n')
  for (let i = 0; i < Q.length; i++) {
    let a = ''
    while (!['y', 'n', 'д', 'н'].includes(a)) {
      stdout.write(`${String(i + 1).padStart(2)}. ${text(Q[i])} ${t.ask}`)
      const next = await lines.next()
      if (next.done) { console.error('\ninput ended before all 20 answers'); exit(2) }
      a = next.value.trim().toLowerCase().slice(0, 1)
    }
    answers.push(a === 'y' || a === 'д')
  }
  rl.close()
}

const yes = answers.filter(Boolean).length
let level = 0
if (yes > 0) for (let l = 1; l < NEEDS.length; l++) if (NEEDS[l].every((n) => answers[n - 1])) level = l

console.log(`\n${t.score}: ${yes}/${Q.length}`)
console.log(`${t.level}: ${LEVELS[lang][level]}`)
console.log(yes < 10 ? t.verdictLow : yes < 15 ? t.verdictMid : t.verdictHigh)
const holes = Q.map((q, i) => [i + 1, q]).filter(([n]) => !answers[n - 1])
console.log('\n' + (holes.length ? t.holes : t.none))
for (const [n, q] of holes) console.log(`  ${String(n).padStart(2)}. ${fix(q)}`)
console.log('\n' + t.read)
