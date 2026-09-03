'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DollarSign, TrendingUp, TrendingDown, Download, Calendar, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface Transaction {
  id: string;
  description: string;
  type: 'income' | 'expense';
  amount: number;
  date: string;
  category: string;
  ref: string;
}

export default function AccountingPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const supabase = createClient();

    const [invoicesRes, expensesRes] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, invoice_number, total, issue_date, status')
        .is('deleted_at', null)
        .order('issue_date', { ascending: false })
        .limit(20),
      supabase
        .from('expenses')
        .select('id, expense_code, description, amount, expense_date, category')
        .is('deleted_at', null)
        .order('expense_date', { ascending: false })
        .limit(20),
    ]);

    if (invoicesRes.error) setError(invoicesRes.error.message);
    if (expensesRes.error) setError(expensesRes.error.message);

    const income: Transaction[] = (invoicesRes.data || []).map((inv: any) => ({
      id: inv.id,
      description: `Invoice ${inv.invoice_number || ''}`,
      type: 'income' as const,
      amount: Number(inv.total) || 0,
      date: inv.issue_date,
      category: 'Revenue',
      ref: inv.invoice_number || '',
    }));

    const expenseTx: Transaction[] = (expensesRes.data || []).map((exp: any) => ({
      id: exp.id,
      description: exp.description || exp.expense_code || 'Expense',
      type: 'expense' as const,
      amount: -(Number(exp.amount) || 0),
      date: exp.expense_date,
      category: exp.category || 'General',
      ref: exp.expense_code || '',
    }));

    const merged = [...income, ...expenseTx].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    setTransactions(merged);
    setLoading(false);
  };

  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = Math.abs(transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
  const netProfit = totalIncome - totalExpense;

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 bg-white/5 rounded w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-white/5 rounded-xl" />)}
        </div>
        <div className="h-96 bg-white/5 rounded-xl" />
      </div>
    );
  }

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

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-400" />
            </div>
            <ArrowUpRight className="w-4 h-4 text-green-400" />
          </div>
          <div className="text-2xl font-bold text-white mb-1">{totalIncome.toLocaleString()} SAR</div>
          <div className="text-sm text-white/60">Total Income (Invoices)</div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <TrendingDown className="w-5 h-5 text-red-400" />
            </div>
            <ArrowDownRight className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-bold text-white mb-1">{totalExpense.toLocaleString()} SAR</div>
          <div className="text-sm text-white/60">Total Expenses</div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <DollarSign className="w-5 h-5 text-blue-400" />
            </div>
          </div>
          <div className={`text-2xl font-bold mb-1 ${netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{netProfit.toLocaleString()} SAR</div>
          <div className="text-sm text-white/60">Net Profit</div>
        </div>
      </div>

      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Recent Transactions</h2>
        </div>
        {transactions.length === 0 ? (
          <div className="text-center py-16 text-white/40">
            <DollarSign className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg">No transactions yet</p>
            <p className="text-sm mt-1">Invoices and expenses will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {transactions.map((tx) => (
              <div key={`${tx.type}-${tx.id}`} className="flex items-center justify-between p-4 hover:bg-white/5 transition">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${tx.type === 'income' ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                    {tx.type === 'income' ? <ArrowUpRight className="w-4 h-4 text-green-400" /> : <ArrowDownRight className="w-4 h-4 text-red-400" />}
                  </div>
                  <div>
                    <div className="text-white font-medium">{tx.description}</div>
                    <div className="text-white/50 text-sm">{tx.category}{tx.date ? ` • ${tx.date}` : ''}</div>
                  </div>
                </div>
                <span className={`font-semibold ${tx.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                  {tx.type === 'income' ? '+' : ''}{tx.amount.toLocaleString()} SAR
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
