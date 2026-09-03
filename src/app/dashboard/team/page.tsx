'use client';

import { useState } from 'react';
import { Users, Plus, Mail, MoreVertical, Shield, UserCheck } from 'lucide-react';

interface TeamMember {
  id: number;
  name: string;
  email: string;
  role: 'Owner' | 'Admin' | 'Member';
  status: 'Active' | 'Pending';
  avatar: string;
}

export default function TeamPage() {
  const [members] = useState<TeamMember[]>([
    { id: 1, name: 'You', email: 'admin@company.com', role: 'Owner', status: 'Active', avatar: 'https://api.dicebear.com/7.x/avatars?seed=1' },
    { id: 2, name: 'John Doe', email: 'john@company.com', role: 'Admin', status: 'Active', avatar: 'https://api.dicebear.com/7.x/avatars?seed=2' },
    { id: 3, name: 'Jane Smith', email: 'jane@company.com', role: 'Member', status: 'Active', avatar: 'https://api.dicebear.com/7.x/avatars?seed=3' },
    { id: 4, name: 'Bob Wilson', email: 'bob@company.com', role: 'Member', status: 'Pending', avatar: 'https://api.dicebear.com/7.x/avatars?seed=4' },
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Team Members</h1>
          <p className="text-white/60">Manage your team and permissions.</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg transition">
          <Plus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Users className="w-5 h-5 text-blue-400" />
            </div>
            <span className="text-white/60 text-sm">Total Members</span>
          </div>
          <div className="text-2xl font-bold text-white">{members.length}</div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-green-500/10 rounded-lg">
              <UserCheck className="w-5 h-5 text-green-400" />
            </div>
            <span className="text-white/60 text-sm">Active</span>
          </div>
          <div className="text-2xl font-bold text-white">{members.filter(m => m.status === 'Active').length}</div>
        </div>
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <Shield className="w-5 h-5 text-purple-400" />
            </div>
            <span className="text-white/60 text-sm">Admins</span>
          </div>
          <div className="text-2xl font-bold text-white">{members.filter(m => m.role === 'Admin' || m.role === 'Owner').length}</div>
        </div>
      </div>

      {/* Team Members Table */}
      <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">All Members</h2>
        </div>
        <div className="divide-y divide-white/5">
          {members.map((member) => (
            <div key={member.id} className="flex items-center justify-between p-4 hover:bg-white/5 transition">
              <div className="flex items-center gap-4">
                <img src={member.avatar} alt={member.name} className="w-10 h-10 rounded-full" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium">{member.name}</span>
                    {member.role === 'Owner' && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">Owner</span>}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-white/60">
                    <Mail className="w-3 h-3" />
                    {member.email}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`text-xs px-3 py-1 rounded-full ${member.status === 'Active' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                  {member.status}
                </span>
                <span className="text-white/60 text-sm w-20">{member.role}</span>
                <button className="p-2 hover:bg-white/10 rounded-lg transition">
                  <MoreVertical className="w-4 h-4 text-white/60" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
