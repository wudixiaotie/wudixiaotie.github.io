---
layout: post
title: "SmartOS update vm nics"
author: "肖铁(Kevin)"
categories: smartos
---

```shell
vim /opt/vm-json/new-ip.json
```

```json
{
  "update_nics": [
    {
      "mac": "72:c1:a8:13:e0:49",
      "ip": "10.20.5.43",
      "ips": [
        "10.20.5.43/24"
      ],
      "vlan_id": 0
    }
  ]
}
```

NIC object needs a .mac property to update, so the json file has to contains a mac.
Then run

```shell
vmadm update a62d6628-159a-eb6a-93fd-d415a1bd8fa2 -f /opt/vm-json/new-ip.json
vmadm reboot a62d6628-159a-eb6a-93fd-d415a1bd8fa2
```

The ip of the vm has been changed.

By the way, If you zlogin a lx branded zone vm timeout, first try to ping it, check  
the response, if its timeout, then update NIC's config and reboot, then you can  
zlogin.