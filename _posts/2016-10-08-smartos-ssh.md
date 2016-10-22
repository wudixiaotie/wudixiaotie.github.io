---
layout: post
title: "SmartOS SSH in native zone"
author: "肖铁(Kevin)"
categories: smartos
---

How could we set an ssh key for remote login in smartos native zone?  
As the wiki says, we should create a file named authorized_keys in ~/.ssh,  
then put you public key in it.
There is another way, 
```shell
echo {"set_customer_metadata": {"root_authorized_keys": "Your_Key"}} | vmadm update <VMUUID>
```
then you can login.  


But there is a weird thing happens, when I change the 'root_authorized_keys' of this VM  
to some other words like 'abcd', my computer still can login to that vm.

Then I try to reboot the vm and run
```shell
mdata-get root_authorized_keys
```
the result is 'abcd'. But I still can login to it.

Fuck! What happened?  

The is a thing called Smart Login make all that happend! It only do one thing:  
if there is someone login to one vm on this hypervisor, it will send user_name &  
public_key hash to `/zones/<zone_uuid>/root/var/tmp/._joyent_sshd_key_is_authorized`  
and chunter will monitor that file to get the infomation it needs, check if the user  
has authorization to login this vm. If he has then write true, or write false when  
he hasn't.

That's the magic.

Have fan, :)