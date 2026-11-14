(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PatrimoniDiagnostics = api;
})(globalThis, function () {
  function render(diagnostics, format = {}) {
    if (!diagnostics) return '';
    const money = format.money || (value => String(value));
    const date = format.dateFormat || (value => value);
    const esc = format.esc || (value => String(value));
    const signed = value => money(value, 'EUR');
    const terminalComponents = diagnostics.rawFlows.filter(flow => flow.kind === 'valor final');
    const terminalDate = terminalComponents.map(flow => flow.date).sort().at(-1);
    const terminalValue = terminalComponents.reduce((sum, flow) => sum + flow.amount, 0);
    const terminalNet = diagnostics.dailyFlows.find(flow => flow.date === terminalDate);
    const endingSummary = terminalDate && terminalNet ? `<section class="trace-ending-summary"><h3>Tancament del període · ${date(terminalDate)}</h3><div class="trace-ending-metrics"><div><small>Valor final del patrimoni</small><strong>${signed(terminalValue)}</strong></div><div><small>Flux net utilitzat per a la XIRR en aquesta data</small><strong>${signed(terminalNet.amount)}</strong></div></div><p>El flux net de la XIRR combina les valoracions finals amb els altres fluxos registrats en aquesta data. No és el valor total del patrimoni.</p><ul>${terminalNet.components.map(flow => `<li><span>${esc(flow.productName || flow.productId || 'Patrimoni')} · ${esc(flow.concept || flow.kind || 'Flux')}</span><strong>${signed(flow.amount)}</strong></li>`).join('')}</ul></section>` : '';
    const rows = diagnostics.rawFlows.map(flow => `<tr><td>${date(flow.date)}</td><td class="flow-amount">${signed(flow.amount)}</td><td>${esc(flow.productName || flow.productId || 'Patrimoni')}</td><td>${esc(flow.concept || flow.kind || 'Flux')}</td></tr>`).join('');
    const changes = diagnostics.signChanges.length
      ? `<ol>${diagnostics.signChanges.map(change => `<li>El flux net passa de ${signed(change.fromAmount)} (${date(change.fromDate)}) a ${signed(change.toAmount)} (${date(change.toDate)}). Contribueixen: ${change.components.map(flow => `${esc(flow.productName || flow.productId || 'Patrimoni')} · ${esc(flow.concept || 'Flux')} · ${signed(flow.amount)}`).join('; ')}</li>`).join('')}</ol>`
      : '<p>No hi ha canvis de signe en els fluxos nets per data.</p>';
    return `<details class="flow-diagnostics" ${diagnostics.signChanges.length ? 'open' : ''}><summary>Traça de diagnòstic · ${diagnostics.rawFlows.length} fluxos · ${diagnostics.signChanges.length} canvis de signe</summary>${endingSummary}<p>Els canvis es determinen sobre la suma neta de cada data. La taula mostra tots els fluxos components inclosos.</p><div class="flow-diagnostic-scroll"><table><thead><tr><th>Data</th><th>Import</th><th>Producte</th><th>Concepte</th></tr></thead><tbody>${rows}</tbody></table></div><h3>Canvis de signe detectats</h3>${changes}</details>`;
  }
  return { render };
});
