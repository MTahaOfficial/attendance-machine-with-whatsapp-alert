import { useState } from 'react';
import { api } from '../../api.js';
import { DownloadIcon } from '../../components/Icons.jsx';
import { Avatar, fmtTime, scoreOf, usePolling } from '../../components/ui.jsx';

const todayLocal = () => new Date().toLocaleDateString('en-CA');

function toCsv(date, events) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Time', 'Name', 'ID', 'Department', 'Allocated time in', 'Type', 'Status', 'Match %', 'Source']];
  for (const e of [...events].reverse()) {
    rows.push([date, new Date(e.ts).toLocaleTimeString([], { hour12: false }), e.name, e.code || '', e.department, e.time_in || '', e.kind === 'in' ? 'Check-in' : 'Check-out', e.status, scoreOf(e.distance ?? 0.3), e.source]);
  }
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

const hm = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return h * 60 + m;
};

/** Everyone's first check-in plotted by how early or late it was, against their own allocated time in. */
function ArrivalStrip({ events, config }) {
  const first = new Map();
  for (const e of [...events].reverse()) if (e.kind === 'in' && !first.has(e.participant_id)) first.set(e.participant_id, e);
  const dots = [...first.values()].map((e) => {
    const t = new Date(e.ts);
    return { id: e.participant_id, name: e.name, late: e.status === 'late', delta: t.getHours() * 60 + t.getMinutes() - hm(e.time_in || config.default_in), time: fmtTime(e.ts) };
  });
  if (!dots.length) return null;
  const lo = Math.floor(Math.min(-30, ...dots.map((d) => d.delta - 4)) / 15) * 15;
  const hi = Math.ceil(Math.max(45, ...dots.map((d) => d.delta + 4)) / 15) * 15;
  const W = 1000;
  const L = 24;
  const R = 24;
  const X = (m) => L + ((m - lo) / (hi - lo)) * (W - L - R);
  const base = 150;
  const bins = new Map();
  const placed = dots
    .sort((a, b) => a.delta - b.delta)
    .map((d) => {
      const k = Math.round(d.delta / 2);
      const n = bins.get(k) || 0;
      bins.set(k, n + 1);
      return { ...d, cx: X(d.delta), cy: base - 10 - n * 17 };
    });
  const ticks = [];
  for (let m = lo; m <= hi; m += 15) ticks.push(m);
  const top = Math.min(...placed.map((d) => d.cy)) - 16;
  const height = Math.max(190, base + 40 - top);
  const shift = Math.min(0, top - 8);
  return (
    <div className="card strip">
      <div className="strip-head">
        <h2>Arrival time</h2>
        <p>Each dot is one person, placed by how early or late they arrived compared with their own time in.</p>
      </div>
      <svg viewBox={`0 ${shift} ${W} ${height + Math.abs(shift)}`} role="img" aria-label="Arrival times compared with allocated time in">
        <rect x={X(0)} y={shift} width={X(config.grace_min) - X(0)} height={base - shift} className="grace" />
        <rect x={X(config.grace_min)} y={shift} width={W - R - X(config.grace_min)} height={base - shift} className="late-zone" />
        <line x1={X(0)} x2={X(0)} y1={shift} y2={base + 6} className="due-line" />
        <line x1={L} x2={W - R} y1={base} y2={base} className="axis" />
        {ticks.map((m) => (
          <g key={m}>
            <line x1={X(m)} x2={X(m)} y1={base} y2={base + 5} className="axis" />
            <text x={X(m)} y={base + 24} textAnchor="middle" className="tick">
              {m === 0 ? 'Due' : m < 0 ? `${-m} early` : `+${m}`}
            </text>
          </g>
        ))}
        {placed.map((d) => (
          <circle key={d.id} cx={d.cx} cy={d.cy} r="7" className={d.late ? 'dot-late' : 'dot-ok'}>
            <title>{`${d.name} - ${d.time} (${d.delta === 0 ? 'right on time' : d.delta < 0 ? `${-d.delta} min early` : `${d.delta} min late`})`}</title>
          </circle>
        ))}
      </svg>
      <div className="strip-legend">
        <span><i className="sw ok" /> On time</span>
        <span><i className="sw late" /> Late</span>
        <span><i className="sw grace" /> Grace period</span>
      </div>
    </div>
  );
}

export default function Attendance() {
  const [date, setDate] = useState(todayLocal());
  const [data, setData] = useState(null);

  // Refresh every 4 s so scans from the kiosk tablet show up live.
  usePolling(() => api(`/c/attendance?date=${date}`).then(setData).catch(() => {}), 4000, [date]);

  const download = () => {
    const blob = new Blob([toCsv(date, data.events)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `attendance-${date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const s = data?.summary;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Attendance</h1>
          <p>Every verified scan, live. Late = first check-in after the person's allocated time in plus grace.</p>
        </div>
        <div className="row">
          <input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value || todayLocal())} style={{ width: 170 }} />
          <button className="btn" onClick={download} disabled={!data?.events.length}>
            <DownloadIcon size={17} /> Export CSV
          </button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="v">{s?.total ?? '–'}</div>
          <div className="l">Participants</div>
        </div>
        <div className="kpi green">
          <div className="v">{s?.present ?? '–'}</div>
          <div className="l">Present</div>
        </div>
        <div className="kpi amber">
          <div className="v">{s?.late ?? '–'}</div>
          <div className="l">Late</div>
        </div>
        <div className="kpi red">
          <div className="v">{s?.absent ?? '–'}</div>
          <div className="l">Absent</div>
        </div>
        <div className="kpi">
          <div className="v">{s?.still_in ?? '–'}</div>
          <div className="l">Still in</div>
        </div>
      </div>

      {data && <ArrivalStrip events={data.events} config={data.config} />}

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Person</th>
              <th>Department</th>
              <th>Time in</th>
              <th>Type</th>
              <th>Status</th>
              <th className="num">Match</th>
            </tr>
          </thead>
          <tbody>
            {data?.events.map((e) => (
              <tr key={e.id}>
                <td className="mono">{fmtTime(e.ts)}</td>
                <td>
                  <div className="person">
                    <Avatar name={e.name} />
                    <div>
                      <b>{e.name}</b>
                      <small>
                        {e.code || '—'}
                        {e.source === 'demo' && ' · demo data'}
                      </small>
                    </div>
                  </div>
                </td>
                <td>{e.department || '—'}</td>
                <td className="mono">{e.time_in || '—'}</td>
                <td>
                  <span className={`badge ${e.kind === 'in' ? 'green' : 'cyan'}`}>{e.kind === 'in' ? 'Check-in' : 'Check-out'}</span>
                </td>
                <td>{e.kind === 'in' && <span className={`badge ${e.status === 'late' ? 'amber' : ''}`}>{e.status === 'late' ? 'Late' : 'On time'}</span>}</td>
                <td className="num">{scoreOf(e.distance ?? 0.3)}%</td>
              </tr>
            ))}
            {data && !data.events.length && (
              <tr>
                <td colSpan="7" className="empty">
                  No scans on this day yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data?.absent.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Not checked in ({data.absent.length})</h2>
          <div className="chips">
            {data.absent.map((p) => (
              <span className="chip" key={p.id}>
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
