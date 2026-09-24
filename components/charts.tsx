"use client";
import { useEffect, useState } from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Tooltip, Legend as CjsLegend, ArcElement,
  BarController, LineController,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { chf, chfWhole, vizToken } from "@/lib/money";
import type { Forecast, Overview } from "@/lib/api";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, CjsLegend, ArcElement, BarController, LineController);

// Charts read their palette from the CSS tokens at render time; a theme
// toggle dispatches "themechange" and every chart re-reads the tokens.
function useThemeVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV(x => x + 1);
    window.addEventListener("themechange", bump);
    return () => window.removeEventListener("themechange", bump);
  }, []);
  return v;
}

function axis() {
  return {
    grid: { color: vizToken("--viz-grid") },
    ticks: { color: vizToken("--text-muted"), font: { size: 11 } },
  };
}
const moneyTick = (v: number | string) => chfWhole(v);

const barShape = { borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom" as const, categoryPercentage: 0.7, barPercentage: 0.9 };

export function IncomeCostsChart({ months }: { months: Overview["monthly_pl"] }) {
  useThemeVersion();
  const ink = vizToken("--text");
  return (
    <Chart type="bar"
      data={{
        labels: months.map(m => m.label),
        datasets: [
          { type: "bar", label: "Income", data: months.map(m => m.income), backgroundColor: vizToken("--viz-income"), ...barShape },
          { type: "bar", label: "Costs", data: months.map(m => m.costs), backgroundColor: vizToken("--viz-costs"), ...barShape },
          { type: "line", label: "Profit", data: months.map(m => m.profit), borderColor: ink, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 2, pointBackgroundColor: ink, tension: 0, order: -1 },
        ],
      }}
      options={{
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${chf(c.parsed.y)}` } } },
        scales: { x: { ...axis(), grid: { display: false } }, y: { ...axis(), ticks: { ...axis().ticks, callback: moneyTick }, beginAtZero: true } },
      }} />
  );
}

export function ForecastChart({ months }: { months: Forecast["months"] }) {
  useThemeVersion();
  const ink = vizToken("--text");
  return (
    <Chart type="bar"
      data={{
        labels: months.map(m => m.label),
        datasets: [
          { type: "bar", label: "Income", data: months.map(m => m.income), backgroundColor: vizToken("--viz-income"), ...barShape },
          { type: "bar", label: "Outflow", data: months.map(m => m.out), backgroundColor: vizToken("--viz-costs"), ...barShape },
          { type: "line", label: "Cash at end", data: months.map(m => m.cash_end), borderColor: ink, borderWidth: 2, pointRadius: 3, pointBackgroundColor: vizToken("--card"), pointBorderWidth: 2, tension: 0.2, order: -1 },
        ],
      }}
      options={{
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${chf(c.parsed.y)}` } } },
        scales: { x: { ...axis(), grid: { display: false } }, y: { ...axis(), ticks: { ...axis().ticks, callback: moneyTick } } },
      }} />
  );
}

export function CategoryBars({ byCategory }: { byCategory: Overview["costs"]["by_category"] }) {
  useThemeVersion();
  const MAX = 6;
  let rows = byCategory;
  if (rows.length > MAX) {
    const rest = rows.slice(MAX - 1).reduce((s, r) => s + r.total, 0);
    rows = [...rows.slice(0, MAX - 1), { category: "Other", total: rest }];
  }
  return (
    <Chart type="bar"
      data={{
        labels: rows.map(r => r.category),
        datasets: [{ data: rows.map(r => r.total), backgroundColor: vizToken("--viz-costs"),
          borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: "left", categoryPercentage: 0.7, barPercentage: 0.9 }],
      }}
      options={{
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${chf(c.parsed.x)}` } } },
        scales: { x: { ...axis(), ticks: { ...axis().ticks, callback: moneyTick, maxRotation: 0, maxTicksLimit: 5 }, beginAtZero: true }, y: { ...axis(), grid: { display: false } } },
      }} />
  );
}
