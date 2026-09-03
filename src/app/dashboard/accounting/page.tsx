'use client';

import { DollarSign, TrendingUp, TrendingDown, Download, Calendar, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function AccountingPage() {
  const transactions = [
    { id: 1, description: 'Trip Payment - Route #1247', type: 'income', amount: 2450, date: '2026-09-02', category: 'Revenue' },
    { id: 2, description: 'Fuel - Truck ABC-1234', type: 'expense', amount: -380, date: '2026-09-02', category: 'Fuel' },
    { id: 3, description: 'Driver Salary - August', type: 'expense', amount: -4500, date: '2026-09-01', category: 'Payroll' },
    { id: 4, description: 'Trip Payment - Route #1246', type: 'income', amount: 1890, date: '2026-09-01', category: 'Revenue' },
    { id: 5, description: 'Maintenance - Scania R500', type: 'expense', amount: -1250, date: '2026-08-31', category: 'Maintenance' },
    { id: 6, description: 'Trip Payment - Route #1245', type: 'income', amount: 3200, date: '2026-08-31', category: 'Revenue' },
  ];

  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = Math.abs(transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const netProfit = totalIncome - totalExpense;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Accounting</h1>
          <p className="text-white/60">Track income, expenses, and profitability.</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 bg-white/5 border border-white/10 text-white px-4 py-2 rounded-lg hover:bg-white/10 transition">
            <Calendar className="w-4 h-4" />
            This Month
          </button>
          <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <span className="flex items-center gap-1 text-green-400 text-sm"><ArrowUpRight className="w-4 h-4" />+18.2%</span>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{totalIncome.toLocaleString()} SAR</div>
          <div className="text-sm text-white/60">Total Income</div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <TrendingDown className="w-5 h-5 text-red-400" />
            </div>
            <span className="flex items-center gap-1 text-red-400 text-sm"><ArrowDownRight className="w-4 h-4" />+5.4%</span>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{totalExpense.toLocaleString()} SAR</div>
          <div className="text-sm text-white/60">Total Expenses</div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <DollarSign className="w-5 h-5 text-blue-400" />
            </div>
            <span className="flex items-center gap-1 text-green-400 text-sm"><ArrowUpRight className="w-4 h-4" />+24.1%</span>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{netProfit.toLocaleString()} SAR</div>
          <div className="text-sm text-white/60">Net Profit</div>
        </div>
      </div>

      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Recent Transactions</h2>
        </div>
        <div className="divide-y divide-white/5">
          {transactions.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between p-4 hover:bg-white/5 transition">
              <div className="flex items-center gap-4">
                <div className={`p-2 rounded-lg ${tx.type === 'income' ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                  {tx.type === 'income' ? <ArrowUpRight className="w-4 h-4 text-green-400" /> : <ArrowDownRight className="w-4 h-4 text-red-400" />}
                </div>
                <div>
                  <div className="text-white font-medium">{tx.description}</div>
                  <div className="text-white/50 text-sm">{tx.category} • {tx.date}</div>
                </div>
              </div>
              <span className={`font-semibold ${tx.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                {tx.type === 'income' ? '+' : ''}{tx.amount.toLocaleString()} SAR
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
