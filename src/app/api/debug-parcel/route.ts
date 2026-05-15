import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const token = process.env.ZREXPRESS_DEBUG_TOKEN || '';
  const tenantId = process.env.ZREXPRESS_DEBUG_TENANT || '';

  if (!token || !tenantId) {
    return NextResponse.json(
      { error: 'ZREXPRESS_DEBUG_TOKEN and ZREXPRESS_DEBUG_TENANT env vars required' },
      { status: 500 },
    );
  }
  
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
