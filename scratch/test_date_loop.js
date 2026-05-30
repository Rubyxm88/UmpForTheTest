const startDate = new Date("2026-04-01T00:00:00");
const endDate = new Date();

try {
  const dates = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  console.log("SUCCESS! Generated", dates.length, "dates. No errors.");
} catch (e) {
  console.error("FAILED with error:", e);
}
