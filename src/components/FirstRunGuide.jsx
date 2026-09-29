const FIRST_RUN_STEPS = [
  { title: 'Выбери картину', text: 'Нажми «Начать раскрашивать» или любую работу ниже — картина откроется сразу.' },
  { title: 'Раскрашивай', text: 'Закрашивай области по номерам. Прогресс сохраняется автоматически.' },
  { title: 'Создавай и собирай', text: '«Создать» превратит твое фото в раскраску, а готовые работы ждут в «Профиле».' },
];

export default function FirstRunGuide({ onDismiss }) {
  return <section className="first-run-guide" data-first-run-guide="true" aria-label="Как начать">
    <div><p className="eyebrow">ПЕРВЫЙ ЗАПУСК</p><h2>Что делать дальше</h2></div>
    <ol>{FIRST_RUN_STEPS.map((step, index) => <li key={step.title}><span className="first-run-step-num" aria-hidden="true">{index + 1}</span><span><b>{step.title}</b><small>{step.text}</small></span></li>)}</ol>
    <button className="primary-button" type="button" onClick={onDismiss}>Понятно, начать</button>
  </section>;
}