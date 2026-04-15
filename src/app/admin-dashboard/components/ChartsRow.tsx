import React from 'react';
import DailyDeliveryChart from './DailyDeliveryChart';
import StatusDistributionChart from './StatusDistributionChart';

export default function ChartsRow() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      <div className="lg:col-span-3">
        <DailyDeliveryChart />
      </div>
      <div className="lg:col-span-2">
        <StatusDistributionChart />
      </div>
    </div>
  );
}