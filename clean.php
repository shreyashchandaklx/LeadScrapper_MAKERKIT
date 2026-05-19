<?php
require 'lib/supabase.php';
\ = 'Status=eq.saved&select=CustomerID,PlaceId';
\ = sb_select('user_leadscrapper_leads', \);
\ = \['json'] ?? [];
\ = 0;
foreach (\ as \) {
    \ = \['CustomerID'];
    \ = \['PlaceId'];
    \ = 'CustomerID=eq.' . urlencode(\) . '&PlaceId=eq.' . urlencode(\) . '&Status=eq.delivered';
    sb_delete('user_leadscrapper_leads', \);
    \++;
}
echo 'Cleaned up ' . \ . ' delivered duplicates\n';
