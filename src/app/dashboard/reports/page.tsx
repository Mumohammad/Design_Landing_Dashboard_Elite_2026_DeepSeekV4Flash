'use client';

import { FileText, Download, Calendar, BarChart3, PieChart, TrendingUp, Filter } from 'lucide-react';

export default function ReportsPage() {
  const reports = [
    { id: 1, name: 'Monthly Revenue Report', description: 'Complete revenue breakdown for August 2026', date: '2026-09-01', type: 'Financial', size: '2.4 MB' },
    { id: 2, name: 'Fleet Performance Report', description: 'Vehicle utilization and efficiency metrics', date: '2026-08-28', type: 'Operations', size: '1.8 MB' },
    { id: 3, name: 'Driver Performance Report', description: 'Driver ratings, trips, and safety scores', date: '2026-08-25', type: 'HR', size: '3.1 MB' },
    { id: 4, name: 'Fuel Consumption Analysis', description: 'Fuel usage trends and cost analysis', date: '2026-08-20', type: 'Operations', size: '1.2 MB' },
    { id: 5, name: 'Maintenance Schedule Report', description: 'Upcoming and completed maintenance tasks', date: '2026-08-15', type: 'Maintenance', size: '980 KB' },
  ];

  const typeColor = (t: string) => ({
    'Financial': 'bg-green-500/20 text-green-400',
    'Operations': 'bg-blue-500/20 text-blue-400',
    'HR': 'bg-purple-500/20 text-purple-400',
    'Maintenance': 'bg-orange-500/20 text-orange-400',
  }[t] || 'bg-slate-500/20 text-slate-400');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Reports</h1>
          <p className="text-white/60">Generate and download business reports.</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition">
          <FileText className="w-4 h-4" />
          Generate Report
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5 hover:border-white/20 transition text-left">
          <div className="p-3 bg-green-500/10 rounded-xl w-fit mb-3">
            <BarChart3 className="w-6 h-6 text-green-400" />
          </div>
          <div className="text-white font-semibold mb-1">Revenue Report</div>
          <div className="text-white/50 text-sm">Financial performance</div>
        </button>
        <button className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5 hover:border-white/20 transition text-left">
          <div className="p-3 bg-blue-500/10 rounded-xl w-fit mb-3">
            <PieChart className="w-6 h-6 text-blue-400" />
          </div>
          <div className="text-white font-semibold mb-1">Fleet Report</div>
          <div className="text-white/50 text-sm">Vehicle analytics</div>
        </button>
        <button className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5 hover:border-white/20 transition text-left">
          <div className="p-3 bg-purple-500/10 rounded-xl w-fit mb-3">
            <TrendingUp className="w-6 h-6 text-purple-400" />
          </div>
          <div className="text-white font-semibold mb-1">Growth Report</div>
          <div className="text-white/50 text-sm">Business growth trends</div>
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button className="flex items-center gap-2 bg-white/5 border border-white/10 text-white px-4 py-3 rounded-lg hover:bg-white/10 transition">
          <Calendar className="w-4 h-4" />
          Date Range
        </button>
        <button className="flex items-center gap-2 bg-white/5 border border-white/10 text-white px-4 py-3 rounded-lg hover:bg-white/10 transition">
          <Filter className="w-4 h-4" />
          All Types
        </button>
      </div>

      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Generated Reports</h2>
        </div>
        <div className="divide-y divide-white/5">
          {reports.map((report) => (
            <div key={report.id} className="flex items-center justify-between p-4 hover:bg-white/5 transition">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <FileText className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <div className="text-white font-medium">{report.name}</div>
                  <div className="text-white/50 text-sm">{report.description}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`text-xs px-3 py-1 rounded-full ${typeColor(report.type)}`}>{report.type}</span>
                <div className="text-right hidden md:block">
                  <div className="text-white/60 text-sm">{report.date}</div>
                  <div className="text-white/40 text-xs">{report.size}</div>
                </div>
                <button className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white px-3 py-2 rounded-lg transition text-sm">
                  <Download className="w-4 h-4" />
                  Download
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
