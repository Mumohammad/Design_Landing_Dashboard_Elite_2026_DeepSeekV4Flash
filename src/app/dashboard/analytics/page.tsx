'use client';

import { TrendingUp, Users, DollarSign, Activity, ArrowUpRight, Download } from 'lucide-react';

export default function AnalyticsPage() {
  const metrics = [
    { title: 'Total Revenue', value: '$45,231.89', change: '+20.1%', trend: 'up' as const, icon: DollarSign },
    { title: 'Active Users', value: '2,350', change: '+15.2%', trend: 'up' as const, icon: Users },
    { title: 'Growth Rate', value: '12.5%', change: '+4.3%', trend: 'up' as const, icon: TrendingUp },
    { title: 'Activity', value: '89.2%', change: '-2.1%', trend: 'down' as const, icon: Activity },
  ];

  const chartData = [
    { month: 'Jan', revenue: 4000, users: 2400 },
    { month: 'Feb', revenue: 3000, users: 1398 },
    { month: 'Mar', revenue: 2000, users: 9800 },
    { month: 'Apr', revenue: 2780, users: 3908 },
    { month: 'May', revenue: 1890, users: 4800 },
    { month: 'Jun', revenue: 2390, users: 3800 },
    { month: 'Jul', revenue: 3490, users: 4300 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Analytics</h1>
          <p className="text-white/60">Track your performance metrics and trends.</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition">
          <Download className="w-4 h-4" />
          Export Report
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, i) => (
          <div key={i} className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5 hover:border-white/20 transition">
            <div className="flex items-center justify-between mb-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <metric.icon className="w-5 h-5 text-blue-400" />
              </div>
              <div className={`flex items-center gap-1 text-sm ${metric.trend === 'up' ? 'text-green-400' : 'text-red-400'}`}>
                <ArrowUpRight className="w-4 h-4" />
                {metric.change}
              </div>
            </div>
            <div className="text-2xl font-bold text-white mb-1">{metric.value}</div>
            <div className="text-sm text-white/60">{metric.title}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Revenue Overview</h2>
          <div className="h-64 flex items-end justify-between gap-2">
            {chartData.map((data, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full bg-gradient-to-t from-blue-500 to-blue-400 rounded-t-lg transition-all hover:from-blue-400 hover:to-blue-300" style={{ height: `${(data.revenue / 10000) * 100}%` }} />
                <span className="text-xs text-white/60">{data.month}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">User Growth</h2>
          <div className="h-64 flex items-end justify-between gap-2">
            {chartData.map((data, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div className="w-full bg-gradient-to-t from-purple-500 to-purple-400 rounded-t-lg transition-all hover:from-purple-400 hover:to-purple-300" style={{ height: `${(data.users / 10000) * 100}%` }} />
                <span className="text-xs text-white/60">{data.month}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Detailed Metrics</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-white/60 text-sm font-medium py-3 px-4">Month</th>
                <th className="text-left text-white/60 text-sm font-medium py-3 px-4">Revenue</th>
                <th className="text-left text-white/60 text-sm font-medium py-3 px-4">Users</th>
                <th className="text-left text-white/60 text-sm font-medium py-3 px-4">Growth</th>
              </tr>
            </thead>
            <tbody>
              {chartData.map((data, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="py-3 px-4 text-white">{data.month}</td>
                  <td className="py-3 px-4 text-white">${data.revenue.toLocaleString()}</td>
                  <td className="py-3 px-4 text-white">{data.users.toLocaleString()}</td>
                  <td className="py-3 px-4"><span className="text-green-400">+{(Math.random() * 20).toFixed(1)}%</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
