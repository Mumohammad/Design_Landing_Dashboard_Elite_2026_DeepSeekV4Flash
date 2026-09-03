'use client';

import { useState, useEffect } from 'react';
import { Settings, Building2, Palette, Bell, Save } from 'lucide-react';

export default function SettingsPage() {
  const [tenant, setTenant] = useState<any>(null);
  const [formData, setFormData] = useState({
    companyName: '',
    email: '',
    primaryColor: '#3b82f6',
    secondaryColor: '#8b5cf6',
  });

  useEffect(() => {
    const stored = localStorage.getItem('tenant');
    if (stored) {
      const data = JSON.parse(stored);
      setTenant(data);
      setFormData({
        companyName: data.name || '',
        email: 'admin@company.com',
        primaryColor: data.brand_colors?.primary || '#3b82f6',
        secondaryColor: data.brand_colors?.secondary || '#8b5cf6',
      });
    }
  }, []);

  const handleSave = () => {
    const updated = { ...tenant, name: formData.companyName, brand_colors: { primary: formData.primaryColor, secondary: formData.secondaryColor } };
    localStorage.setItem('tenant', JSON.stringify(updated));
    setTenant(updated);
    alert('Settings saved!');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
        <p className="text-white/60">Manage your company profile and preferences.</p>
      </div>

      {/* Company Profile */}
      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <Building2 className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold text-white">Company Profile</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2">Company Name</label>
            <input type="text" value={formData.companyName} onChange={(e) => setFormData({ ...formData, companyName: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition" />
          </div>
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2">Email</label>
            <input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="w-full bg-white/5 border border-white/10 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition" />
          </div>
        </div>
      </div>

      {/* Branding */}
      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <Palette className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-semibold text-white">Branding</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2">Primary Color</label>
            <div className="flex gap-3">
              <input type="color" value={formData.primaryColor} onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })} className="w-12 h-12 rounded-lg border border-white/10 cursor-pointer" />
              <input type="text" value={formData.primaryColor} onChange={(e) => setFormData({ ...formData, primaryColor: e.target.value })} className="flex-1 bg-white/5 border border-white/10 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition" />
            </div>
          </div>
          <div>
            <label className="block text-white/80 text-sm font-medium mb-2">Secondary Color</label>
            <div className="flex gap-3">
              <input type="color" value={formData.secondaryColor} onChange={(e) => setFormData({ ...formData, secondaryColor: e.target.value })} className="w-12 h-12 rounded-lg border border-white/10 cursor-pointer" />
              <input type="text" value={formData.secondaryColor} onChange={(e) => setFormData({ ...formData, secondaryColor: e.target.value })} className="flex-1 bg-white/5 border border-white/10 rounded-lg py-3 px-4 text-white focus:outline-none focus:border-blue-500 transition" />
            </div>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <Bell className="w-5 h-5 text-green-400" />
          <h2 className="text-lg font-semibold text-white">Notifications</h2>
        </div>
        <div className="space-y-3">
          {['Email notifications', 'Push notifications', 'Weekly reports'].map((item, i) => (
            <label key={i} className="flex items-center justify-between p-3 bg-white/5 rounded-lg cursor-pointer hover:bg-white/10 transition">
              <span className="text-white">{item}</span>
              <input type="checkbox" defaultChecked={i === 0} className="w-5 h-5 rounded border-white/20 bg-white/10 text-blue-600 focus:ring-blue-500" />
            </label>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <button onClick={handleSave} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-semibold transition">
        <Save className="w-4 h-4" />
        Save Changes
      </button>
    </div>
  );
}
