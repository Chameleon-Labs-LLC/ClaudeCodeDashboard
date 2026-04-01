interface StatCardProps {
  label: string;
  value: number | string;
  icon?: string;
}

export default function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <div className="bg-brand-navy-light border border-brand-navy-light/50 rounded-xl p-5 hover:border-brand-cyan/20 transition-colors">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">{label}</p>
        {icon && <span className="text-2xl">{icon}</span>}
      </div>
      <p className="text-3xl font-bold text-white mt-2">{value}</p>
    </div>
  );
}
