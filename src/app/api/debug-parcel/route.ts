import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const token = 'zZhWCuWzJFvXUnRoYyoyFRqBBQZvVSk4vYPJcZjuoGeLtKBw3rcfL1EVvs07CJvv';
  const tenantId = '3da412b7-5c9e-4fe9-bd40-8ee76fe6163c';
  
  const res = await fetch('https://api.zrexpress.app/api/v1.0/parcels/search', {
    method: 'POST',
    headers: {
      'X-Api-Key': token,
      'X-Tenant': tenantId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pageNumber: 1, pageSize: 1 }),
  });
  
  const data = await res.json();
  const items = data.items || data.content || data.data || [];
  const first = items[0] || {};
  
  // Return the full raw parcel object
  return NextResponse.json({ 
    raw: first,
    keys: Object.keys(first),
    customerKeys: first.customer ? Object.keys(first.customer) : [],
    phoneValue: first.customer?.phone,
    deliveryAddressValue: first.deliveryAddress,
    trackingNumber: first.trackingNumber,
    id: first.id,
  });
}
