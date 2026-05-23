import React from 'react';
import { X } from 'lucide-react';
import { HubProfileCard, HubNotificationCard, HubLogoutCard } from '../../services/merlin-hub-sdk/react';

export default function HubProfileModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-slate-50 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl relative animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 sm:p-8 space-y-6">
          <HubProfileCard onSuccess={() => {}} />
          <HubNotificationCard />
          <HubLogoutCard onLogout={onClose} />
        </div>
      </div>
    </div>
  );
}
