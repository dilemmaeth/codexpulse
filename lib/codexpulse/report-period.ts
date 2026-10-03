import type { MonthView } from './analytics';
import type { Language } from './types';

export function reportPeriod(view: MonthView, language: Language) {
  const hu = language === 'hu';
  const status = view.comparisonThroughDay
    ? (hu ? `Részleges hónap · Adatok eddig: ${view.generatedDate}` : `Partial month · Data through: ${view.generatedDate}`)
    : (hu ? 'Teljes havi időszak a rögzített adatok alapján' : 'Full monthly period in the recorded data');
  let comparison = hu ? 'Nincs elegendő korábbi használati adat az összehasonlításhoz.' : 'Not enough prior usage data for comparison.';
  if (view.comparisonMonth && view.previousMonthChange !== null) {
    const month = new Intl.DateTimeFormat(hu ? 'hu-HU' : 'en-US', { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${view.comparisonMonth}-01T12:00:00Z`));
    comparison = hu ? `Viszonyítás: ${month}` : `Compared with: ${month}`;
    if (view.comparisonThroughDay) comparison += hu ? ` · mindkét hónap első ${view.comparisonThroughDay} napja` : ` · first ${view.comparisonThroughDay} days of both months`;
    if (view.comparisonEstimated) comparison += hu ? ' · becslést is tartalmaz' : ' · includes estimates';
  }
  return { status, comparison };
}
