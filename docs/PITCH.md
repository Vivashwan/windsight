# Windsight: client pitch

The trading audience here is the utility's day-ahead power desk. Each section below is one slide or demo step, with talking points.

---

## 1. The problem you live with every morning

- Before gate closure on D-1, you decide how much power to buy for tomorrow. Whatever wind doesn't cover has to come from the market.
- Wind is weather. Buy against a forecast that is too high, and you're short tomorrow. Then you buy back in intraday or pay imbalance prices.
- Two questions matter at the gate:
  - **What is the latest wind forecast I can actually act on?**
  - **How wrong is it likely to be?**

## 2. What Windsight does

Two screens, both built on Elexon's official national wind data.

**Day-ahead decision.** Pick tomorrow's delivery day and see:

- the exact forecast run available at your gate, with how many minutes before the gate it landed and when the next run arrives
- how much that forecast moved since the previous run
- a **bias-adjusted estimate** and an **80% range** for every hour, learned only from errors you could already have seen

**Forecast accuracy.** See how good that forecast really was:

- typical and worst-case error
- whether it runs high or low
- how error grows with lead time
- which hours of the day and which days it missed

## 3. Demo script

| Step | Action | Talking point |
|---|---|---|
| 1 | Open *Day-ahead decision* on 15 Jan, with "Show what actually happened" **off** | This is exactly what you'd have seen at 09:50 on the 14th: the 09:30 run, published 20 minutes before the gate. |
| 2 | Point at the stats | "Forecast says 287 GWh tomorrow. History says it has been running 1.8 GW high. The adjusted view says 256 GWh." |
| 3 | Toggle actuals **on** | "Outturn was 261 GWh. The adjusted number was 5 GWh off; the raw forecast was 26 GWh too high." |
| 4 | Switch the gate to **EPEX 09:20** | The forecast falls back to the 07:30 run. Gate timing changes which information you trade on. |
| 5 | Open *Forecast accuracy* | Use the January numbers in the next section. |
| 6 | Turn on *Fixed lead time* and drag the slider from 0 h to 48 h | Error grows from 1.7 GW to 2.3 GW. Every extra hour of lead time costs accuracy. |
| 7 | Open *Error by delivery day*, then *Table view* | 28 Jan, 12 Jan and 11 Jan were misses of about 5 GW. These are the days to review with your risk team. |

## 4. What January 2026 tells you (09:50 gate)

- **Typical miss: 2.0 GW per hour**, about 18% of average wind output.
- **The forecast ran high on 27 of 31 days**, by 1.7 GW on average. Taking the raw forecast at face value would have left you short almost every day.
- **1 hour in 20 missed by more than 5.3 GW.** This is the size of risk to plan cover for.
- **Correcting for recent bias cuts the typical error by 22%** (from 1,991 MW to 1,553 MW), using only information available at the time.
- **The 80% range held up:** outturn landed inside it 80.9% of the time. It is a range you can rely on.

## 5. Why trust it

- It uses Elexon BMRS data only, and every number can be traced to a published forecast run and metered outturn.
- There is no hindsight in the decision tools. The bands and adjustments are back-tested the way you would have used them.
- It is transparent: tables behind every chart, and the method is documented.

## 6. What's next (with you)

- Run it on live rolling data, refreshed after each forecast run (8 a day).
- Add demand and solar forecasts, so the screen shows the **residual volume to buy**, not just wind.
- Add half-hourly product support and alerts when a new run moves the forecast materially before the gate.
- Investigate the systematic over-forecast with you. Curtailment is a likely driver, and knowing it improves the adjustment.

**Ask:** a 4-week pilot alongside your current process. Each morning, compare Windsight's adjusted view with what you actually bought.
